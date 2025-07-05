/* global ethers **********************************************/

const FACTORY_ADDR = "0x63a9F0360e073688854099cc2A9Ca931B006a91A";
const UMA_ADAPTER  = "0x2F5e3684Cb1F318eC51B00eDba38d79AC2c0Aa9d";

const FACTORY_ABI = [
  "function partition(address parent,address oracle,bytes32 questionId)"
  + " external returns(address vault,address yesToken,address noToken)",
  "event VaultCreated(address indexed parent,bytes32 indexed questionId,"
  + "address vault,address yesToken,address noToken)"
];

const VAULT_ABI = [
  "function pushDown(uint256)",
  "function pullUp(uint256)",
  "function settle(uint256)",
  "function resolved() view returns (bool)",
  "function winningIndex() view returns (uint8)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function approve(address,uint256)"
];

let provider, signer, vault, parentToken;

/* ---- connect wallet (renamed) -------------------------------- */
async function connectWallet() {
  if (!window.ethereum)
    throw new Error("No EIP-1193 wallet found – install MetaMask");
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
}

/* ---- tiny helpers ------------------------------------------- */
function slugFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/");
    return parts.pop() || parts.pop();       // handle trailing /
  } catch { return ""; }
}

async function fetchQuestionId(slug) {
  const r = await fetch(`https://clob.polymarket.com/markets?slug=${slug}`);
  const j = await r.json();
  if (!j.data?.length) throw new Error("Market not found");
  return j.data[0].question_id;
}

async function decimals(addr) {
  return new ethers.Contract(addr, ERC20_ABI, provider).decimals();
}

/* ─── 1. CREATE VAULT ───────────────────────────────────────── */
document.getElementById("btnCreate").onclick = async () => {
  try {
    await connectWallet();

    const marketUrl  = document.getElementById("marketUrl").value.trim();
    const parentAddr = document.getElementById("parentToken").value.trim();
    if (!marketUrl || !parentAddr) throw new Error("Fill both fields");

    const qId  = await fetchQuestionId(slugFromUrl(marketUrl));
    const factory = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, signer);

    const tx = await factory.partition(parentAddr, UMA_ADAPTER, qId);
    const rc = await tx.wait();
    const { vault, yesToken, noToken } =
      rc.logs.find(l => l.fragment?.name === "VaultCreated").args;

    // cache contracts
    vault       = new ethers.Contract(vault, VAULT_ABI, signer);
    parentToken = new ethers.Contract(parentAddr, ERC20_ABI, signer);

    // pre-fill UI
    document.getElementById("vaultAddress").value  = vault.target;
    document.getElementById("vaultAddress2").value = vault.target;
    document.getElementById("createOut").textContent =
      `Vault: ${vault.target}\nYES:  ${yesToken}\nNO :  ${noToken}`;
  } catch (e) {
    document.getElementById("createOut").textContent = "Error: " + e.message;
  }
};

/* ─── 2. PUSH DOWN ─────────────────────────────────────────── */
document.getElementById("btnPush").onclick = async () => {
  try {
    const dec  = await decimals(parentToken.target);
    const amt  = ethers.parseUnits(
                   document.getElementById("moveAmount").value.trim(), dec);
    await (await parentToken.approve(vault.target, amt)).wait();
    await (await vault.pushDown(amt)).wait();
    document.getElementById("moveOut").textContent = "pushDown() ✅";
  } catch (e) { document.getElementById("moveOut").textContent = e.message; }
};

/* ─── 3. PULL UP ───────────────────────────────────────────── */
document.getElementById("btnPull").onclick = async () => {
  try {
    const dec  = await decimals(parentToken.target);
    const amt  = ethers.parseUnits(
                   document.getElementById("moveAmount").value.trim(), dec);
    await (await vault.pullUp(amt)).wait();
    document.getElementById("moveOut").textContent = "pullUp() ✅";
  } catch (e) { document.getElementById("moveOut").textContent = e.message; }
};

/* ─── 4. CHECK RESOLUTION ─────────────────────────────────── */
document.getElementById("btnCheck").onclick = async () => {
  try {
    const done = await vault.resolved();
    document.getElementById("settleOut").textContent =
      done ? "Resolved, winning index = " + await vault.winningIndex()
           : "Not resolved yet";
  } catch (e) { document.getElementById("settleOut").textContent = e.message; }
};

/* ─── 5. SETTLE ────────────────────────────────────────────── */
document.getElementById("btnSettle").onclick = async () => {
  try {
    const dec  = await decimals(parentToken.target);
    const amt  = ethers.parseUnits(
                   document.getElementById("settleAmount").value.trim(), dec);
    await (await vault.settle(amt)).wait();
    document.getElementById("settleOut").textContent = "settle() ✅";
  } catch (e) { document.getElementById("settleOut").textContent = e.message; }
};
