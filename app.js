/* global ethers **********************************************/

/* ─── constants ───────────────────────────────────────────── */
const FACTORY_ADDR = "0x63a9F0360e073688854099cc2A9Ca931B006a91A";   // MultiverseFactory
const UMA_ADAPTER  = "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d";   // UMA v3 (Polygon)

/* ─── ABIs ────────────────────────────────────────────────── */
const FACTORY_ABI = [
  "function partition(address parent,address oracle,bytes32 questionId)" +
  " returns(address vault,address yesToken,address noToken)",
  "event VaultCreated(address indexed parentToken,bytes32 indexed questionId," +
  "address vault,address yesToken,address noToken)"
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
  
  /* ─── globals ─────────────────────────────────────────────── */
  let provider, signer, vault, parentToken;
  
  /* ─── wallet helpers ──────────────────────────────────────── */
  async function connectWallet() {
    if (!window.ethereum) throw new Error("Install MetaMask");
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
  }
  async function ensureWallet() { if (!signer) await connectWallet(); }
  
  /* ─── misc helpers ───────────────────────────────────────── */
  function slugFromUrl(url) {
    try {
      const p = new URL(url).pathname.split("/");
      return p.pop() || p.pop();                       // handle trailing /
    } catch { return ""; }
  }
  async function fetchQuestionId(slug) {
    const r = await fetch(`https://clob.polymarket.com/markets?slug=${slug}`);
    const j = await r.json();
    if (!j.data?.length) throw new Error("Market not found");
    return j.data[0].question_id;
  }
  
  /* ─── keep vault & parentToken in sync ───────────────────── */
  async function updateVault(addr) {
    if (!ethers.isAddress(addr)) return;               // ignore junk
    await ensureWallet();
  
    vault = new ethers.Contract(addr, VAULT_ABI, signer);
  
    /* parent() is missing on very old vaults → fall back to manual input */
    let pAddr;
    try { pAddr = await vault.parent(); }              // new vaults
    catch {
      pAddr = document.getElementById("parentToken").value.trim();
      if (!ethers.isAddress(pAddr))
        throw new Error("Vault has no parent() -- please type the ERC-20 address first");
    }
  
    parentToken = new ethers.Contract(pAddr, ERC20_ABI, signer);
  
    document.getElementById("vaultAddress").value  = addr;
    document.getElementById("vaultAddress2").value = addr;
  }
  ["vaultAddress", "vaultAddress2"].forEach(id =>
    document.getElementById(id).addEventListener("change",
      e => updateVault(e.target.value.trim())));
  
  /* ─── label the button right away ────────────────────────── */
  document.getElementById("btnCreate").textContent = "Fetch or Create Vault";
  
  /* ─── 1. FETCH **or** CREATE VAULT ───────────────────────── */
  document.getElementById("btnCreate").onclick = async () => {
    try {
      await ensureWallet();
  
      const marketUrl  = document.getElementById("marketUrl").value.trim();
      const parentAddr = ethers.getAddress(
        document.getElementById("parentToken").value.trim()
      );
      if (!marketUrl || !parentAddr) throw new Error("Fill both inputs");
  
      const qId   = await fetchQuestionId(slugFromUrl(marketUrl));
      const fac   = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, signer);
      let vAddr, yesToken, noToken, created = false, txHash = "";

      /* step-A: try a staticCall – it only succeeds if the vault
                 is already deployed, costs 0 gas                       */
      try {
        [vAddr, yesToken, noToken] =
          await fac.partition.staticCall(parentAddr, UMA_ADAPTER, qId);
      } catch {
        /* step-B: vault not found – send a real tx to create it */
        const rc = await (await fac.partition(parentAddr, UMA_ADAPTER, qId)).wait();
        ({ vault: vAddr, yesToken, noToken } =
          rc.logs.find(l => l.fragment?.name === "VaultCreated").args);
        created = true;
        txHash  = rc.hash;
      }

      if (logs.length) {
        ({ vault: vAddr, yesToken, noToken } = iface.parseLog(logs.at(-1)).args);
      } else {
        /* step-B: vault not yet deployed – call partition() */
        const rc = await (await fac.partition(parentAddr, UMA_ADAPTER, qId)).wait();
        ({ vault: vAddr, yesToken, noToken } =
          rc.logs.find(l => l.fragment?.name === "VaultCreated").args);
        created = true;
        txHash  = rc.hash;
      }
  
      await updateVault(vAddr);
  
      document.getElementById("createOut").textContent =
        (created ? `Vault created (tx ${txHash.slice(0,10)}…) ✅\n`
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
      if (!vault || !parentToken) throw new Error("Enter or fetch a vault first");
  
      const dec = await parentToken.decimals();
      const amt = ethers.parseUnits(document.getElementById("moveAmount").value, dec);
  
      await (await parentToken.approve(await vault.getAddress(), amt)).wait();
      await (await vault.pushDown(amt)).wait();
      document.getElementById("moveOut").textContent = "pushDown() ✅";
    } catch (e) { document.getElementById("moveOut").textContent = e.message; }
  };
  
  /* ─── 3. PULL UP ─────────────────────────────────────────── */
  document.getElementById("btnPull").onclick = async () => {
    try {
      await updateVault(document.getElementById("vaultAddress").value.trim());
      if (!vault || !parentToken) throw new Error("Enter or fetch a vault first");
  
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
      if (!vault) throw new Error("Enter or fetch a vault first");
  
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
      if (!vault || !parentToken) throw new Error("Enter or fetch a vault first");
  
      const dec = await parentToken.decimals();
      const amt = ethers.parseUnits(document.getElementById("settleAmount").value, dec);
  
      await (await vault.settle(amt)).wait();
      document.getElementById("settleOut").textContent = "settle() ✅";
    } catch (e) { document.getElementById("settleOut").textContent = e.message; }
  };