/* Svemir · LIVING SEEDS & SEED ARCADE — minimalan on-chain čitač (bez zavisnosti).
 * samo JSON-RPC eth_call + ručno ABI dekodiranje statičkih povratnih vrednosti.
 * Koristi ga i GitHub Pages stranica i node test — ista logika, isti dokaz. */

export const SEL = {
  // LivingSeeds
  totalSupply: '0x18160ddd',
  currentPrice: '0x9d1b464a',
  cultivationFee: '0xe33c6c01',
  seeds: '0xf0503e80', // seeds(uint256) -> (uint80,uint48,uint32,uint32,uint64)
  tokenSVG: '0x9bac5f7a', // tokenSVG(uint256) -> string
  ownerOf: '0x6352211e', // ownerOf(uint256) -> address
  phaseOf: '0x9a243ebf', // phaseOf(uint256) -> uint8
  maxPerWallet: '0x453c2310',
  MAX_SUPPLY: '0x32cb6b0c',

  // SeedArcade
  dailyPot: '0xc37bd929',
  dailyPodium: '0x887efe6d',
  dutchPrice: '0xb199410e',
  elementOf: '0x23f18920',
  stats: '0xad217ae5',
};

export const PHASES = ['SPROUT', 'GROWTH', 'BLOOM', 'MATURE', 'PATINA'];
export const ELEMENTS = [
  { name: 'SOLAR', icon: '☀️', color: '#ffb347', beats: 'VERDANT' },
  { name: 'VERDANT', icon: '🌿', color: '#77dd77', beats: 'ABYSSAL' },
  { name: 'ABYSSAL', icon: '🌊', color: '#70b5ff', beats: 'CELESTIAL' },
  { name: 'CELESTIAL', icon: '✨', color: '#c3aed6', beats: 'SOLAR' },
];

export async function call(rpc, selector, argUint, target) {
  const data = argUint === undefined
    ? selector
    : selector + BigInt(argUint).toString(16).padStart(64, '0');
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: target || config().address, data }, 'latest'],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(rpc + ' → ' + (j.error.message || JSON.stringify(j.error)));
  return j.result;
}

/** konfiguracija: na strani je window.LIVINGSEED_CONFIG, u node-u import config.js */
let cfg;
export function config(c) { if (c) cfg = c; return cfg; }

export const word = (hex, i) => BigInt('0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
export const uint = (hex, i = 0) => word(hex, i);

// The arcade enforces the current mint tranche as a floor on its Dutch quote.
export function auctionQuote(garden) {
  if (!garden.arcade) throw new Error('Auction quote unavailable');
  return garden.arcade.dutchPrice > garden.price ? garden.arcade.dutchPrice : garden.price;
}

/** povratna vrednost string-a (offset, len, data) — dekodiran kao UTF-8 */
export function stringRet(hex) {
  const len = Number(word(hex, 1));
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.substr(2 + 128 + i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

/** seeds(id) -> { genome, bornAt, hops, cultivations, scar } */
export function seedRet(hex) {
  return {
    genome: uint(hex, 0),
    bornAt: Number(uint(hex, 1)),
    hops: Number(uint(hex, 2)),
    cultivations: Number(uint(hex, 3)),
    scar: uint(hex, 4),
  };
}

export function statsRet(hex) {
  if (!hex || hex === '0x') return { wins: 0, losses: 0, nectar: 0, dailyNectar: 0 };
  return {
    wins: Number(uint(hex, 0)),
    losses: Number(uint(hex, 1)),
    nectar: Number(uint(hex, 2)),
    dailyNectar: Number(uint(hex, 3)),
  };
}

export async function readGarden(rpc, limit = 64) {
  const [supplyHex, priceHex, feeHex, maxHex] = await Promise.all([
    call(rpc, SEL.totalSupply), call(rpc, SEL.currentPrice),
    call(rpc, SEL.cultivationFee), call(rpc, SEL.maxPerWallet),
  ]);
  const totalSupply = Number(uint(supplyHex));
  const tokens = [];

  const arcadeAddr = config()?.arcadeAddress;
  const hasArcade = arcadeAddr && arcadeAddr !== '0x0000000000000000000000000000000000000000';

  let arcadeData = null;
  if (hasArcade) {
    try {
      const [potHex, dutchHex, pod0, pod1, pod2] = await Promise.all([
        call(rpc, SEL.dailyPot, undefined, arcadeAddr),
        call(rpc, SEL.dutchPrice, undefined, arcadeAddr),
        call(rpc, SEL.dailyPodium, 0, arcadeAddr),
        call(rpc, SEL.dailyPodium, 1, arcadeAddr),
        call(rpc, SEL.dailyPodium, 2, arcadeAddr),
      ]);
      const parsePod = (h) => {
        const v = uint(h);
        return v === BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') ? null : Number(v);
      };
      arcadeData = {
        dailyPot: uint(potHex),
        dutchPrice: uint(dutchHex),
        podium: [parsePod(pod0), parsePod(pod1), parsePod(pod2)],
      };
    } catch (e) {
      console.warn('Arcade read error', e);
    }
  }

  for (let id = 0; id < Math.min(totalSupply, limit); id++) {
    const promises = [
      call(rpc, SEL.tokenSVG, id),
      call(rpc, SEL.seeds, id),
      call(rpc, SEL.phaseOf, id),
      call(rpc, SEL.ownerOf, id),
    ];
    if (hasArcade) {
      promises.push(call(rpc, SEL.stats, id, arcadeAddr).catch(() => '0x'));
    }

    const res = await Promise.all(promises);
    const svgHex = res[0];
    const seedHex = res[1];
    const phaseHex = res[2];
    const ownerHex = res[3];
    const statsHex = hasArcade ? res[4] : null;

    const seed = seedRet(seedHex);
    const element = ELEMENTS[Number(seed.genome % 4n)];

    tokens.push({
      id,
      svg: stringRet(svgHex),
      seed,
      phase: PHASES[Number(uint(phaseHex))] || '?',
      owner: '0x' + seedHexOrAddr(ownerHex),
      element,
      stats: statsRet(statsHex),
    });
  }

  return {
    totalSupply,
    price: uint(priceHex),
    cultivationFee: uint(feeHex),
    maxPerWallet: Number(uint(maxHex)),
    tokens,
    arcade: arcadeData,
  };
}

function seedHexOrAddr(hex) {
  return hex.slice(-40);
}

export const fmtETH = (wei) => (Number(wei) / 1e18).toFixed(4) + ' ETH';

export function configured(c = config()) {
  if (c?.mode === 'demo') return c.chainId === 84532 && validAddress(c.address) && /^0x0{40}$/i.test(c.arcadeAddress || '');
  return !!c && Number.isSafeInteger(c.chainId) && c.chainId > 0 && validAddress(c.address) && validAddress(c.arcadeAddress);
}
function validAddress(a) { return /^0x[0-9a-f]{40}$/i.test(a || '') && !/^0x0{40}$/i.test(a); }
async function guardWrite(target, expected) {
  if (config()?.mode === 'demo' && config().writesEnabled !== true) throw new Error('Transactions disabled: demo validation pending');
  if (!configured() || !validAddress(target) || target.toLowerCase() !== expected?.toLowerCase()) throw new Error('Deployment is not configured');
  if (!window.ethereum) throw new Error('Wallet not connected');
  const chain = await window.ethereum.request({method:'eth_chainId'});
  if (Number(BigInt(chain)) !== config().chainId) throw new Error('Wrong network: select chain ' + config().chainId);
  const code = await window.ethereum.request({method:'eth_getCode',params:[target,'latest']});
  if (!/^0x[0-9a-f]+$/i.test(code || '') || /^0x0*$/i.test(code)) throw new Error('No contract deployed at target');
  if (config().mode === 'demo') await verifyDemo(window.ethereum.request.bind(window.ethereum));
}
export async function verifyDemo(request) {
  if (!configured() || config().mode !== 'demo') throw new Error('Demo is not configured');
  if (Number(BigInt(await request({method:'eth_chainId'}))) !== 84532) throw new Error('Wrong network');
  for (const data of ['0x8da5cb5b', '0x05b40dea']) {
    const value = await request({method:'eth_call',params:[{to:config().address,data},'latest']});
    if (!/^0x0{64}$/i.test(value || '')) throw new Error('Demo is not finalized: owner and arcade must be zero');
  }
}
export async function waitForReceipt(hash, request = window.ethereum.request.bind(window.ethereum), {attempts=60, delay=2000} = {}) {
  const chain = await request({method:'eth_chainId'});
  for (let i=0; i<attempts; i++) {
    if (await request({method:'eth_chainId'}) !== chain) throw new Error('Network changed; check transaction on original network');
    const receipt = await request({method:'eth_getTransactionReceipt',params:[hash]});
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Transaction reverted');
      return receipt;
    }
    await new Promise(resolve=>setTimeout(resolve,delay));
  }
  throw new Error('Confirmation pending; check the transaction before retrying');
}
export async function connectWallet() {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('No Web3 wallet found. Please use Coinbase Wallet, MetaMask, or Rainbow.');
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
  return { account: accounts[0], chainId: parseInt(chainIdHex, 16) };
}

export async function snipePlantWeb3(arcadeAddr, valueWei, userAddr) {
  if (config()?.mode === 'demo') throw new Error('Arcade disabled in demo');
  await guardWrite(arcadeAddr, config()?.arcadeAddress);
  if (!window.ethereum) throw new Error('Wallet not connected');
  const selector = '0x75887e49'; // snipePlant(address)
  const data = selector + userAddr.replace(/^0x/, '').padStart(64, '0');
  return await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: userAddr,
      to: arcadeAddr,
      value: '0x' + BigInt(valueWei).toString(16),
      data: data,
    }],
  });
}

export async function plantDirectWeb3(seedsAddr, priceWei, userAddr) {
  await guardWrite(seedsAddr, config()?.address);
  if (!window.ethereum) throw new Error('Wallet not connected');
  const selector = '0x779b3c5c'; // plant()
  return await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: userAddr,
      to: seedsAddr,
      value: '0x' + BigInt(priceWei).toString(16),
      data: selector,
    }],
  });
}

export async function cultivateWeb3(seedsAddr, feeWei, seedId, userAddr) {
  await guardWrite(seedsAddr, config()?.address);
  if (!window.ethereum) throw new Error('Wallet not connected');
  const selector = '0xac8a16a8'; // cultivate(uint256)
  const data = selector + BigInt(seedId).toString(16).padStart(64, '0');
  return await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: userAddr,
      to: seedsAddr,
      value: '0x' + BigInt(feeWei).toString(16),
      data: data,
    }],
  });
}
