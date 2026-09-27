// Phase 2: buy RF through the Rare Friends Market and hardwire the burner's Friend.
// Verified sources (Sourcify, full match): RareFriendsMarket.buyExactRF, ActivationManager.hardwire,
// RareFriendsGenerations.hardwire (generation = highest affordable by the holder's live RF balance).
//
//   node scripts/onchain/friend.mjs <generation 1-6> [--send]
// Order: wrap ETH → buy ONLY the target band's RF → hardwire (pays the denomination: half burned,
// half to Friend rewards) → verify generation/owner and the SDK eligibility check.
import { parseAbi, parseEther, parseEventLogs, formatEther, formatUnits } from "viem";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { rehearseThenSend } from "./lib.mjs";
import { ethToBuyRf } from "../lib/market.mjs";

const MARKET = "0x99930E551b6f849bAabC4B491053eF28a700C4F2", MANAGER = "0xD4A35e11318E3679168d409184B788bcF9F283Ac";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D", RF = "0x0779369854d3EcdEA927206718FFD7730C67B71f";
const WETH_ABI = parseAbi(["function deposit() payable", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const MARKET_ABI = parseAbi(["function buyExactRF(uint256 rfAmount, uint256 maxWethIn, address recipient, uint256 deadline) returns (uint256)", "function weth() view returns (address)"]);
const MANAGER_ABI = parseAbi(["function hardwire(uint8 expectedGeneration) returns (uint256)", "function retired() view returns (bool)", "event Hardwired(address indexed holder, uint256 indexed tokenId, uint8 generation)"]);
const GEN_ABI = parseAbi(["function temporaryFriend(address) view returns (uint256)", "function generation(uint256) view returns (uint8)", "function ownerOf(uint256) view returns (address)", "function denomination(uint8) pure returns (uint256)"]);

const generation = Number(process.argv[2]);
if (!(generation >= 1 && generation <= 6)) throw new Error("usage: friend.mjs <generation 1-6> [--send]");
const E18 = 10n ** 18n;
const denomination = 10n ** BigInt(6 - generation) * E18;
// End the buy inside [denomination, next band) with the denomination still spendable: target 2× (capped below the next band).
const target = generation === 1 ? denomination * 2n : denomination * 2n < denomination * 10n ? denomination * 2n : denomination;

const result = await rehearseThenSend(`friend:gen${generation}`, async ({ client, wallet, account, mainnet, plan, sent }) => {
  const step = async (purpose, request, extra = {}) => {
    const gas = await client.estimateContractGas({ ...request, account });
    const hash = await wallet.writeContract({ ...request, account, chain: wallet.chain });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`FREEZE: ${purpose} reverted (${hash})`);
    if (mainnet) await sent(purpose, receipt); else plan({ purpose, to: request.address, fn: request.functionName, args: (request.args ?? []).map(String).join(", "), valueWei: request.value ?? 0n, gas: gas.toString(), ...extra });
    return receipt;
  };
  if (await client.readContract({ address: MANAGER, abi: MANAGER_ABI, functionName: "retired" })) throw new Error("ActivationManager is retired");
  const weth = await client.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "weth" });
  const rfBefore = await client.readContract({ address: RF, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  const need = target > rfBefore ? target - rfBefore : 0n;
  if (need > 0n) {
    // Wrap enough WETH for a pool-maths estimate + 10%, then take a fresh exact quote by simulation.
    const estimate = parseEther((ethToBuyRf(Number(formatUnits(need, 18))) * 1.1).toFixed(18));
    const wethBalance = await client.readContract({ address: weth, abi: WETH_ABI, functionName: "balanceOf", args: [account.address] });
    if (wethBalance < estimate) await step("wrap ETH → WETH", { address: weth, abi: WETH_ABI, functionName: "deposit", value: estimate - wethBalance });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await step("approve WETH → Market", { address: weth, abi: WETH_ABI, functionName: "approve", args: [MARKET, estimate] });
    const { result: quotedWeth } = await client.simulateContract({ address: MARKET, abi: MARKET_ABI, functionName: "buyExactRF", args: [need, estimate, account.address, deadline], account });
    const maxWethIn = (quotedWeth * 103n) / 100n;
    if (maxWethIn > estimate) throw new Error(`FREEZE: quote ${formatEther(quotedWeth)} WETH exceeds wrapped estimate`);
    console.log(`  fresh quote: ${formatUnits(need, 18)} RF for ${formatEther(quotedWeth)} WETH (max ${formatEther(maxWethIn)} at 3%)`);
    await step(`buy ${formatUnits(need, 18)} RF`, { address: MARKET, abi: MARKET_ABI, functionName: "buyExactRF", args: [need, maxWethIn, account.address, deadline] }, { budget: { rfSwapOut: need, minOut: need, quoteOut: need } });
  }
  const temporary = await client.readContract({ address: GENERATIONS, abi: GEN_ABI, functionName: "temporaryFriend", args: [account.address] });
  if (temporary === 0n) throw new Error("FREEZE: no temporary Friend after the buy");
  await step("approve RF → ActivationManager", { address: RF, abi: ERC20, functionName: "approve", args: [MANAGER, denomination] });
  const receipt = await step(`hardwire Gen ${generation}`, { address: MANAGER, abi: MANAGER_ABI, functionName: "hardwire", args: [generation] });
  const [event] = parseEventLogs({ abi: MANAGER_ABI, eventName: "Hardwired", logs: receipt.logs.filter(log => log.address.toLowerCase() === MANAGER.toLowerCase()) });
  const tokenId = event.args.tokenId;
  const [gen, owner] = await Promise.all([client.readContract({ address: GENERATIONS, abi: GEN_ABI, functionName: "generation", args: [tokenId] }), client.readContract({ address: GENERATIONS, abi: GEN_ABI, functionName: "ownerOf", args: [tokenId] })]);
  if (gen !== generation || owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`FREEZE: expected Gen ${generation} owned by burner, got Gen ${gen} owner ${owner}`);
  const eligibility = await readGenerationEligibility(client, tokenId, account.address);
  if (!eligibility.eligible) throw new Error("FREEZE: SDK eligibility check failed");
  return { tokenId: tokenId.toString(), generation: gen, owner, sdkEligible: eligibility.eligible };
});
if (result) console.log("Friend ready:", result);
