/* global ethers **********************************************/

/* ─── constants ───────────────────────────────────────────── */
const FACTORY_ADDR = "0x63a9F0360e073688854099cc2A9Ca931B006a91A";
const UMA_ADAPTER  = "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d";

/* ─── ABIs ────────────────────────────────────────────────── */
const FACTORY_ABI = [
  "function partition(address parent,address oracle,bytes32 questionId)" +
  " returns(address vault,address yesToken,address noToken)"
];

const VAULT_ABI = [
  "function pushDown(uint256)",
  "function pullUp(uint256)",
  "function settle(uint256)",
  "function resolved() view returns (bool)",
  "function winningIndex() view returns (uint8)",
  "function parent() view returns (address)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function approve(address,uint256)"
];

/* ─── globals (filled at runtime) ─────────────────────────── */
let provider, signer, vault, parentToken;

/* ─── connect helpers ─────────────────────────────────────── */
async function connectWallet() {
  if (!window.ethereum) throw new Error("Install MetaMask");
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
}
async function ensureWallet() { if (!signer) await connectWallet(); }

/* ─── text helpers ───────────────────────────────────────── */
function slugFromUrl(url) {
  try { const p = new URL(url).pathname.split("/"); return p.pop() || p.pop(); }
  catch { return ""; }
}
async function fetchQuestionId(slug) {
  const r = await fetch(`https://clob.polymarket.com/markets?slug=${slug}`);
  const j = await r.json();
  if (!j.data?.length) throw new Error("Market not found");
  return j.data[0].question_id;
}

/* ─── vault sync when user edits the address boxes ────────── */
async function updateVault(addr) {
  if (!ethers.isAddress(addr)) return;
  await ensureWallet();
  vault = new ethers.Contract(addr, VAULT_ABI, signer);
  const parentAddr = await vault.parent();
  parentToken = new ethers.Contract(parentAddr, ERC20_ABI, signer);
  document.getElementById("vaultAddress").value  = addr;
  document.getElementById("vaultAddress2").value = addr;
}
["vaultAddress", "vaultAddress2"].forEach(id =>
  document.getElementById(id).addEventListener("change",
    e => updateVault(e.target.value.trim())));


/* ─── 1. FETCH **or** CREATE VAULT ───────────────────────── */
document.getElementById("btnCreate").onclick = async () => {
  try {
    await ensureWallet();

    const marketUrl  = document.getElementById("marketUrl").value.trim();
    const parentAddr = document.getElementById("parentToken").value.trim();
    if (!marketUrl || !parentAddr) throw new Error("Fill both inputs");

    const qId   = await fetchQuestionId(slugFromUrl(marketUrl));
    const fac   = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, signer);

    let vAddr, yesToken, noToken, txHash, created = false;

    /* first try a static call – succeeds if vault already exists */
    try {
      [vAddr, yesToken, noToken] =
        await fac.partition.staticCall(parentAddr, UMA_ADAPTER, qId);
    } catch (_) {
      /* vault doesn’t exist – send a real tx to create it */
      const rc = await (await fac.partition(parentAddr, UMA_ADAPTER, qId)).wait();
      ({ vault: vAddr, yesToken, noToken } =
        rc.logs.find(l => l.fragment?.name === "VaultCreated").args);
      txHash  = rc.hash;
      created = true;
    }

    await updateVault(vAddr);   // sets globals + fills both inputs

    document.getElementById("createOut").textContent =
      (created ? `Vault created (tx ${txHash.slice(0,10)}...) ✅\n`
               : "Existing vault fetched ✅\n") +
      `Vault: ${vAddr}\nYES : ${yesToken}\nNO  : ${noToken}`;
  } catch (e) {
    document.getElementById("createOut").textContent = "Error: " + e.message;
  }
};

/* ─── 2. PUSH DOWN ───────────────────────────────────────── */
document.getElementById("btnPush").onclick = async () => {
  try {
    await updateVault(document.getElementById("vaultAddress").value.trim());
    if (!vault || !parentToken) throw new Error("Enter or create a vault first");

    const dec = await parentToken.decimals();
    const amt = ethers.parseUnits(document.getElementById("moveAmount").value, dec);

    await (await parentToken.approve(vault.target, amt)).wait();
    await (await vault.pushDown(amt)).wait();
    document.getElementById("moveOut").textContent = "pushDown() ✅";
  } catch (e) { document.getElementById("moveOut").textContent = e.message; }
};

/* ─── 3. PULL UP ─────────────────────────────────────────── */
document.getElementById("btnPull").onclick = async () => {
  try {
    await updateVault(document.getElementById("vaultAddress").value.trim());
    if (!vault || !parentToken) throw new Error("Enter or create a vault first");

    const dec = await parentToken.decimals();
    const amt = ethers.parseUnits(document.getElementById("moveAmount").value, dec);

    await (await vault.pullUp(amt)).wait();
    document.getElementById("moveOut").textContent = "pullUp() ✅";
  } catch (e) { document.getElementById("moveOut").textContent = e.message; }
};

/* ─── 4. CHECK RESOLUTION ───────────────────────────────── */
document.getElementById("btnCheck").onclick = async () => {
  try {
    await updateVault(document.getElementById("vaultAddress2").value.trim());
    if (!vault) throw new Error("Enter or create a vault first");

    const done = await vault.resolved();
    document.getElementById("settleOut").textContent =
      done ? `Resolved – winning index = ${await vault.winningIndex()}`
           : "Not resolved yet";
  } catch (e) { document.getElementById("settleOut").textContent = e.message; }
};

/* ─── 5. SETTLE ─────────────────────────────────────────── */
document.getElementById("btnSettle").onclick = async () => {
  try {
    await updateVault(document.getElementById("vaultAddress2").value.trim());
    if (!vault || !parentToken) throw new Error("Enter or create a vault first");

    const dec = await parentToken.decimals();
    const amt = ethers.parseUnits(document.getElementById("settleAmount").value, dec);

    await (await vault.settle(amt)).wait();
    document.getElementById("settleOut").textContent = "settle() ✅";
  } catch (e) { document.getElementById("settleOut").textContent = e.message; }
};
