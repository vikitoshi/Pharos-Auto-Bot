require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');
const axios = require('axios');
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log('-------------------------------------------------');
    console.log(' Pharos Testnet Auto Bot - Airdrop Insiders');
    console.log('-------------------------------------------------');
    console.log(`${colors.reset}\n`);
  },
};

const networkConfig = {
  name: 'Pharos Testnet',
  chainId: 688688,
  rpcUrl: 'https://testnet.dplabs-internal.com',
  currencySymbol: 'PHRS',
};

const tokens = {
  USDC: '0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37',
  WPHRS: '0x76aaada469d23216be5f7c596fa25f282ff9b364',
};

const contractAddress = '0x1a4de519154ae51200b0ad7c90f7fac75547888a';

const tokenDecimals = {
  WPHRS: 18,
  USDC: 6,
};

const contractAbi = [
  'function multicall(uint256 collectionAndSelfcalls, bytes[] data) public',
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) public returns (bool)',
];

const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    return proxies;
  } catch (error) {
    logger.warn('No proxies.txt found or failed to load, switching to direct mode');
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const setupProvider = (proxy = null) => {
  if (proxy) {
    logger.info(`Using proxy: ${proxy}`);
    const agent = new HttpsProxyAgent(proxy);
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    }, {
      fetchOptions: { agent },
      headers: { 'User-Agent': randomUseragent.getRandom() },
    });
  } else {
    logger.info('Using direct mode (no proxy)');
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    });
  }
};

const pairOptions = [
  { id: 1, from: 'WPHRS', to: 'USDC' },
  { id: 2, from: 'USDC', to: 'WPHRS' },
];

const checkBalanceAndApproval = async (wallet, tokenAddress, amount, decimals, spender) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(`Skipping: Insufficient ${tokenDecimals[decimals] === 18 ? 'WPHRS' : 'USDC'} balance: ${ethers.formatUnits(balance, decimals)} < ${amount}`);
      return false;
    }

    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance < required) {
      logger.step(`Approving ${amount} tokens for ${spender}...`);
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256);
      await approveTx.wait();
      logger.success('Approval completed');
    }

    return true;
  } catch (error) {
    logger.error(`Balance/approval check failed: ${error.message}`);
    return false;
  }
};

const getMulticallData = (pair, amount, walletAddress) => {
  try {
    const decimals = tokenDecimals[pair.from];
    const scaledAmount = ethers.parseUnits(amount.toString(), decimals);

    if (pair.from === 'WPHRS' && pair.to === 'USDC') {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
        [
          tokens.WPHRS,
          tokens.USDC,
          500,
          walletAddress,
          '0x0000002386f26fc10000',
          0,
          0,
        ]
      );
      return [ethers.concat(['0x04e45aaf', data])];
    } else if (pair.from === 'USDC' && pair.to === 'WPHRS') {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
        [
          tokens.USDC,
          tokens.WPHRS,
          500,
          '0x0000000000000000000000000000000000000002',
          '0x016345785d8a0000',
          '0x0007cd553d27f466',
          0,
        ]
      );
      return [ethers.concat(['0x04e45aaf', data])];
    } else {
      logger.error(`Invalid pair: ${pair.from} -> ${pair.to}`);
      return [];
    }
  } catch (error) {
    logger.error(`Failed to generate multicall data: ${error.message}`);
    return [];
  }
};

const performSwap = async (wallet, provider, index) => {
  try {
    const pair = pairOptions[Math.floor(Math.random() * pairOptions.length)];
    const amount = pair.from === 'WPHRS' ? 0.001 : 0.1; 
    logger.step(`Preparing swap ${index + 1}: ${pair.from} -> ${pair.to} (${amount} ${pair.from})`);

    const decimals = tokenDecimals[pair.from];
    const tokenContract = new ethers.Contract(tokens[pair.from], erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(`Skipping swap ${index + 1}: Insufficient ${pair.from} balance: ${ethers.formatUnits(balance, decimals)} < ${amount}`);
      return;
    }

    if (!(await checkBalanceAndApproval(wallet, tokens[pair.from], amount, decimals, contractAddress))) {
      return;
    }

    const contract = new ethers.Contract(contractAddress, contractAbi, wallet);

    const multicallData = getMulticallData(pair, amount, wallet.address);
    if (!multicallData || multicallData.length === 0 || multicallData.some(data => !data || data === '0x')) {
      logger.error(`Invalid or empty multicall data for ${pair.from} -> ${pair.to}`);
      return;
    }

    const gasLimit = 219249; 

    const tx = await contract.multicall(
      ethers.toBigInt(Math.floor(Date.now() / 1000)),
      multicallData,
      {
        gasLimit,
        gasPrice: 0, 
      }
    );

    logger.loading(`Swap transaction ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Swap ${index + 1} completed: ${receipt.hash}`);
  } catch (error) {
    logger.error(`Swap ${index + 1} failed: ${error.message}`);
    if (error.transaction) {
      logger.error(`Transaction details: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`Receipt: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const transferPHRS = async (wallet, provider, index) => {
  try {
    const amount = 0.000001; 
    const randomWallet = ethers.Wallet.createRandom();
    const toAddress = randomWallet.address;
    logger.step(`Preparing PHRS transfer ${index + 1}: ${amount} PHRS to ${toAddress}`);

    const balance = await provider.getBalance(wallet.address);
    const required = ethers.parseEther(amount.toString());

    if (balance < required) {
      logger.warn(`Skipping transfer ${index + 1}: Insufficient PHRS balance: ${ethers.formatEther(balance)} < ${amount}`);
      return;
    }

    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: required,
      gasLimit: 21000, 
      gasPrice: 0, 
    });

    logger.loading(`Transfer transaction ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Transfer ${index + 1} completed: ${receipt.hash}`);
  } catch (error) {
    logger.error(`Transfer ${index + 1} failed: ${error.message}`);
    if (error.transaction) {
      logger.error(`Transaction details: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`Receipt: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const claimFaucet = async (wallet, proxy = null) => {
  try {
    logger.step(`Checking faucet eligibility for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: 'post',
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('Sending login request for faucet...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`Login failed for faucet: ${loginData.msg || 'Unknown error'}`);
      return false;
    }

    const jwt = loginData.data.jwt;
    logger.success(`Login successful for faucet, JWT: ${jwt}`);

    const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
    const statusHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('Checking faucet status...');
    const statusResponse = await axios({
      method: 'get',
      url: statusUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const statusData = statusResponse.data;

    if (statusData.code !== 0 || !statusData.data) {
      logger.error(`Faucet status check failed: ${statusData.msg || 'Unknown error'}`);
      return false;
    }

    if (!statusData.data.is_able_to_faucet) {
      const nextAvailable = new Date(statusData.data.avaliable_timestamp * 1000).toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
      logger.warn(`Faucet not available until: ${nextAvailable}`);
      return false;
    }

    const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
    logger.loading('Claiming faucet...');
    const claimResponse = await axios({
      method: 'post',
      url: claimUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const claimData = claimResponse.data;

    if (claimData.code === 0) {
      logger.success(`Faucet claimed successfully for ${wallet.address}`);
      return true;
    } else {
      logger.error(`Faucet claim failed: ${claimData.msg || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logger.error(`Faucet claim failed for ${wallet.address}: ${error.message}`);
    return false;
  }
};

const performCheckIn = async (wallet, proxy = null) => {
  try {
    logger.step(`Performing daily check-in for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: 'post',
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('Sending login request...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`Login failed: ${loginData.msg || 'Unknown error'}`);
      return false;
    }

    const jwt = loginData.data.jwt;
    logger.success(`Login successful, JWT: ${jwt}`);

    const checkInUrl = `https://api.pharosnetwork.xyz/sign/in?address=${wallet.address}`;
    const checkInHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('Sending check-in request...');
    const checkInResponse = await axios({
      method: 'post',
      url: checkInUrl,
      headers: checkInHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const checkInData = checkInResponse.data;

    if (checkInData.code === 0) {
      logger.success(`Check-in successful for ${wallet.address}`);
      return true;
    } else {
      logger.warn(`Check-in failed, possibly already checked in: ${checkInData.msg || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logger.error(`Check-in failed for ${wallet.address}: ${error.message}`);
    return false;
  }
};

const countdown = async () => {
  const totalSeconds = 30 * 60; 
  logger.info('Starting 30-minute countdown...');

  for (let seconds = totalSeconds; seconds >= 0; seconds--) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    process.stdout.write(`\r${colors.cyan}Time remaining: ${minutes}m ${secs}s${colors.reset} `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\rCountdown complete! Restarting process...\n');
};

const main = async () => {
  logger.banner();

  const proxies = loadProxies();
  const privateKeys = [process.env.PRIVATE_KEY_1, process.env.PRIVATE_KEY_2].filter(pk => pk);
  if (!privateKeys.length) {
    logger.error('No private keys found in .env');
    return;
  }

  while (true) {
    for (const privateKey of privateKeys) {
      const proxy = proxies.length ? getRandomProxy(proxies) : null;
      const provider = setupProvider(proxy);
      const wallet = new ethers.Wallet(privateKey, provider);

      logger.wallet(`Using wallet: ${wallet.address}`);

      await claimFaucet(wallet, proxy);

      await performCheckIn(wallet, proxy);

      for (let i = 0; i < 10; i++) {
        await transferPHRS(wallet, provider, i);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
      }

      for (let i = 0; i < 10; i++) {
        await performSwap(wallet, provider, i);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
      }
    }

    logger.success('All actions completed for all wallets!');

    await countdown();
  }
};

main().catch(error => {
  logger.error(`Bot failed: ${error.message}`);
  process.exit(1);
});
