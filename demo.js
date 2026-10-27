// Mint and care for a seed; show only observed chain state.
import {config, configured, readGarden, fmtETH, connectWallet, plantDirectWeb3, cultivateWeb3, verifyDemo, waitForReceipt} from './rpc.js';
const cfg = config(window.LIVINGSEED_CONFIG);
const el = id => document.getElementById(id);
let account = null, busy = false, ready = false;
const status = message => { el('status').textContent = message; };
function controls() {
  el('refresh').disabled = !ready || busy;
  for (const id of ['connect','plant']) el(id).disabled = !ready || busy || cfg.writesEnabled !== true;
  document.querySelectorAll('[data-care]').forEach(b => { b.disabled = !ready || busy || cfg.writesEnabled !== true || b.dataset.owner !== account?.toLowerCase(); });
}
async function rpc(q) {
  const response = await fetch(cfg.rpc, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,...q})});
  if (!response.ok) throw Error('RPC unavailable');
  const result = await response.json();
  if (result.error) throw Error(result.error.message);
  return result.result;
}
async function refresh() {
  ready = false; controls();
  await verifyDemo(rpc);
  const garden = await readGarden(cfg.rpc,333);
  el('summary').textContent = `${garden.totalSupply} / 333 planted · Mint ${fmtETH(garden.price)} · Care ${fmtETH(garden.cultivationFee)} (test ETH)`;
  el('grid').replaceChildren();
  for (const t of garden.tokens) {
    const card = document.createElement('article'); card.className = 'card';
    const img = document.createElement('img'); img.alt = `Living Seed ${t.id}`;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t.svg);
    const title = document.createElement('h2'); title.textContent = `Seed #${t.id} · ${t.phase}`;
    const detail = document.createElement('p'); detail.textContent = `${t.seed.cultivations} cares · ${t.seed.hops} transfers`;
    const owner = document.createElement('p'); owner.textContent = 'Owner: ' + t.owner;
    owner.style.overflowWrap = 'anywhere';
    const button = document.createElement('button'); button.textContent = 'Cultivate';
    button.dataset.care = t.id; button.dataset.owner = t.owner.toLowerCase();
    button.onclick = () => transact(async () => {
      const fee = (await readGarden(cfg.rpc,0)).cultivationFee;
      return cultivateWeb3(cfg.address,fee,t.id,account);
    });
    card.append(img,title,detail,owner,button); el('grid').append(card);
  }
  el('coverage').textContent = garden.totalSupply ? `Showing ${garden.tokens.length} seeds.` : 'The garden is empty.';
  if (cfg.writesEnabled !== true) status('Read-only preview. On-chain mint and care are verified; browser-wallet validation is pending.');
  el('deployment').textContent = 'Testnet contract connected · owner renounced · arcade absent';
  ready = true; controls();
}
async function connect() {
  const wallet = await connectWallet();
  if (wallet.chainId !== cfg.chainId) throw Error('Select Base Sepolia in your wallet');
  account = wallet.account;
  el('connect').textContent = account.slice(0,6) + '…' + account.slice(-4); controls();
}
async function transact(send) {
  if (busy || !ready || cfg.writesEnabled !== true) return;
  busy = true; controls();
  el('transaction').removeAttribute('href'); el('transaction').textContent = '';
  try {
    await connect(); status('Confirm the transaction in your wallet.');
    const hash = await send();
    el('transaction').href = 'https://sepolia.basescan.org/tx/' + hash;
    el('transaction').textContent = 'View transaction: ' + hash;
    status('Submitted. Waiting for confirmation…');
    await waitForReceipt(hash);
    status('Transaction confirmed. Refreshing artwork…');
    try { await refresh(); status('Transaction confirmed. Garden refreshed.'); }
    catch (e) { status('Transaction confirmed; refresh unavailable: ' + e.message); }
  } catch (e) { status(e.message); }
  finally { busy = false; controls(); }
}
el('connect').onclick = () => connect().catch(e => status(e.message));
el('plant').onclick = () => transact(async () => plantDirectWeb3(cfg.address,(await readGarden(cfg.rpc,0)).price,account));
el('refresh').onclick = () => refresh().catch(e => { status(e.message); el('refresh').disabled = false; });
window.ethereum?.on?.('accountsChanged', () => { account=null; el('connect').textContent='Connect wallet'; controls(); });
window.ethereum?.on?.('chainChanged', () => { account=null; el('connect').textContent='Connect wallet'; controls(); });
if (configured(cfg) && cfg.mode === 'demo') {
  el('contract').href = cfg.explorer + cfg.address; el('contract').textContent = cfg.address;
  refresh().catch(e => { status(e.message); el('refresh').disabled=false; });
}
