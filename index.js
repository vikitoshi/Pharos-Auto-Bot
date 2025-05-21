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
  user: (msg) => console.log(`\n${colors.white}[➤] ${msg}${colors.reset}`),
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
  USDT: '0xed59de2d7ad9c043442e381231ee3646fc3c2939',
  POSITION_MANAGER: '0xF8a1D4FF0f9b9Af7CE58E1fc1833688F3BFd6115',
};

const poolAddresses = {
  USDC_WPHRS: '0x0373a059321219745aee4fad8a942cf088be3d0e',
  USDT_WPHRS: '0x70118b6eec45329e0534d849bc3e588bb6752527',
};

const contractAddress = '0x1a4de519154ae51200b0ad7c90f7fac75547888a';

const tokenDecimals = {
  WPHRS: 18,
  USDC: 6,
  USDT: 6,
};

const contractAbi = [
  {
    inputs: [
      { internalType: 'uint256', name: 'collectionAndSelfcalls', type: 'uint256' },
      { internalType: 'bytes[]', name: 'data', type: 'bytes[]' },
    ],
    name: 'multicall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function decimals() view returns (uint8)',
  'function deposit() public payable',
  'function withdraw(uint256 wad) public',
];

const positionManagerAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'token0', type: 'address' },
          { internalType: 'address', name: 'token1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickLower', type: 'int24' },
          { internalType: 'int24', name: 'tickUpper', type: 'int24' },
          { internalType: 'uint256', name: 'amount0Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.MintParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
];

const pairOptions = [
  { id: 1, from: 'WPHRS', to: 'USDC', amount: 0.01 },
  { id: 2, from: 'WPHRS', to: 'USDT', amount: 0.01 },
  { id: 3, from: 'USDC', to: 'WPHRS', amount: 0.01 },
  { id: 4, from: 'USDT', to: 'WPHRS', amount: 0.01 },
  { id: 5, from: 'USDC', to: 'USDT', amount: 0.01 },
  { id: 6, from: 'USDT', to: 'USDC', amount: 0.01 },
];

const lpOptions = [
  { id: 1, token0: 'WPHRS', token1: 'USDC', amount0: 0.01, amount1: 0.01, fee: 3000 },
  { id: 2, token0: 'WPHRS', token1: 'USDT', amount0: 0.01, amount1: 0.01, fee: 3000 },
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

const checkBalanceAndApproval = async (wallet, tokenAddress, amount, decimals, spender) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(
        `Skipping: Insufficient ${Object.keys(tokenDecimals).find(
          key => tokenDecimals[key] === decimals
        )} balance: ${ethers.formatUnits(balance, decimals)} < ${amount}`
      );
      return false;
    }

    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance < required) {
      logger.step(`Approving ${amount} tokens for ${spender}...`);
      const estimatedGas = await tokenContract.approve.estimateGas(spender, ethers.MaxUint256);
      const feeData = await wallet.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256, {
        gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
        gasPrice,
        maxFeePerGas: feeData.maxFeePerGas || undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
      });
      await approveTx.wait();
      logger.success('Approval completed');
    }

    return true;
  } catch (error) {
    logger.error(`Balance/approval check failed: ${error.message}`);
    return false;
  }
};

const getUserInfo = async (wallet, proxy = null, jwt) => {
  try {
    logger.user(`Fetching user info for wallet: ${wallet.address}`);
    const profileUrl = `https://api.pharosnetwork.xyz/user/profile?address=${wallet.address}`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
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
      method: 'get',
      url: profileUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('Fetching user profile...');
    const response = await axios(axiosConfig);
    const data = response.data;

    if (data.code !== 0 || !data.data.user_info) {
      logger.error(`Failed to fetch user info: ${data.msg || 'Unknown error'}`);
      return;
    }

    const userInfo = data.data.user_info;
    logger.info(`User ID: ${userInfo.ID}`);
    logger.info(`Task Points: ${userInfo.TaskPoints}`);
    logger.info(`Total Points: ${userInfo.TotalPoints}`);
  } catch (error) {
    logger.error(`Failed to fetch user info: ${error.message}`);
  }
};

const getMulticallData = (pair, amount, walletAddress) => {
  try {
    const decimals = tokenDecimals[pair.from];
    const scaledAmount = ethers.parseUnits(amount.toString(), decimals);

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
      [
        tokens[pair.from],
        tokens[pair.to],
        500,
        walletAddress,
        scaledAmount,
        0,
        0,
      ]
    );

    return [ethers.concat(['0x04e45aaf', data])];
  } catch (error) {
    logger.error(`Failed to generate multicall data: ${error.message}`);
    return [];
  }
};

const performSwap = async (wallet, provider, index) => {
  try {
    const pair = pairOptions[Math.floor(Math.random() * pairOptions.length)];
    const amount = pair.amount;
    logger.step(
      `Preparing swap ${index + 1}: ${pair.from} -> ${pair.to} (${amount} ${pair.from})`
    );

    const decimals = tokenDecimals[pair.from];
    const tokenContract = new ethers.Contract(tokens[pair.from], erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(
        `Skipping swap ${index + 1}: Insufficient ${pair.from} balance: ${ethers.formatUnits(
          balance,
          decimals
        )} < ${amount}`
      );
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

    const deadline = Math.floor(Date.now() / 1000) + 300;
    let estimatedGas;
    try {
      estimatedGas = await contract.multicall.estimateGas(deadline, multicallData, {
        from: wallet.address,
      });
    } catch (error) {
      logger.error(`Gas estimation failed for swap ${index + 1}: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await contract.multicall(deadline, multicallData, {
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`Swap transaction ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Swap ${index + 1} completed: ${receipt.hash}`);
    logger.step(`Explorer: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);
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

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: required,
      gasLimit: 21000,
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`Transfer transaction ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Transfer ${index + 1} completed: ${receipt.hash}`);
    logger.step(`Explorer: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);
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

const wrapPHRS = async (wallet, provider, index) => {
  try {
    const minAmount = 0.000001;
    const maxAmount = 0.00001;
    const amount = minAmount + Math.random() * (maxAmount - minAmount);
    const amountWei = ethers.parseEther(amount.toFixed(6).toString());
    logger.step(`Preparing wrap PHRS ${index + 1}: ${amount.toFixed(6)} PHRS to WPHRS`);

    const balance = await provider.getBalance(wallet.address);
    if (balance < amountWei) {
      logger.warn(`Skipping wrap ${index + 1}: Insufficient PHRS balance: ${ethers.formatEther(balance)} < ${amount.toFixed(6)}`);
      return;
    }

    const wphrsContract = new ethers.Contract(tokens.WPHRS, erc20Abi, wallet);
    let estimatedGas;
    try {
      estimatedGas = await wphrsContract.deposit.estimateGas({ value: amountWei });
    } catch (error) {
      logger.error(`Gas estimation failed for wrap ${index + 1}: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await wphrsContract.deposit({
      value: amountWei,
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`Wrap transaction ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Wrap ${index + 1} completed: ${receipt.hash}`);
    logger.step(`Explorer: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);
  } catch (error) {
    logger.error(`Wrap ${index + 1} failed: ${error.message}`);
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
      return null;
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
      return jwt;
    } else {
      logger.warn(`Check-in failed, possibly already checked in: ${checkInData.msg || 'Unknown error'}`);
      return jwt;
    }
  } catch (error) {
    logger.error(`Check-in failed for ${wallet.address}: ${error.message}`);
    return null;
  }
};

const addLiquidity = async (wallet, provider, index) => {
  try {
    const pair = lpOptions[Math.floor(Math.random() * lpOptions.length)];
    const amount0 = pair.amount0;
    const amount1 = pair.amount1;
    logger.step(
      `Preparing Liquidity Add ${index + 1}: ${pair.token0}/${pair.token1} (${amount0} ${pair.token0}, ${amount1} ${pair.token1})`
    );

    const decimals0 = tokenDecimals[pair.token0];
    const amount0Wei = ethers.parseUnits(amount0.toString(), decimals0);
    if (!(await checkBalanceAndApproval(wallet, tokens[pair.token0], amount0, decimals0, tokens.POSITION_MANAGER))) {
      return;
    }

    const decimals1 = tokenDecimals[pair.token1];
    const amount1Wei = ethers.parseUnits(amount1.toString(), decimals1);
    if (!(await checkBalanceAndApproval(wallet, tokens[pair.token1], amount1, decimals1, tokens.POSITION_MANAGER))) {
      return;
    }

    const positionManager = new ethers.Contract(tokens.POSITION_MANAGER, positionManagerAbi, wallet);

    const deadline = Math.floor(Date.now() / 1000) + 600; 
    const tickLower = -60000; 
    const tickUpper = 60000;

    const mintParams = {
      token0: tokens[pair.token0],
      token1: tokens[pair.token1],
      fee: pair.fee,
      tickLower,
      tickUpper,
      amount0Desired: amount0Wei,
      amount1Desired: amount1Wei,
      amount0Min: 0,
      amount1Min: 0,
      recipient: wallet.address,
      deadline,
    };

    let estimatedGas;
    try {
      estimatedGas = await positionManager.mint.estimateGas(mintParams, { from: wallet.address });
    } catch (error) {
      logger.error(`Gas estimation failed for LP ${index + 1}: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    const tx = await positionManager.mint(mintParams, {
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`Liquidity Add ${index + 1} sent, waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.success(`Liquidity Add ${index + 1} completed: ${receipt.hash}`);
    logger.step(`Explorer: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);
  } catch (error) {
    logger.error(`Liquidity Add ${index + 1} failed: ${error.message}`);
    if (error.transaction) {
      logger.error(`Transaction details: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`Receipt: ${JSON.stringify(error.receipt, null, 2)}`);
    }
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

  const numTransfers = 10; 
  const numWraps = 10; 
  const numSwaps = 10; 
  const numLPs = 10; 

  while (true) {
    for (const privateKey of privateKeys) {
      const proxy = proxies.length ? getRandomProxy(proxies) : null;
      const provider = setupProvider(proxy);
      const wallet = new ethers.Wallet(privateKey, provider);

      logger.wallet(`Using wallet: ${wallet.address}`);

      await claimFaucet(wallet, proxy);

      const jwt = await performCheckIn(wallet, proxy);
      if (jwt) {
        await getUserInfo(wallet, proxy, jwt);
      } else {
        logger.error('Skipping user info fetch due to failed check-in');
      }

      console.log(`\n${colors.cyan}------------------------${colors.reset}`);
      console.log(`${colors.cyan}TRANSFERS${colors.reset}`);
      console.log(`${colors.cyan}------------------------${colors.reset}`);
      for (let i = 0; i < numTransfers; i++) {
        await transferPHRS(wallet, provider, i);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
      }

      console.log(`\n${colors.cyan}------------------------${colors.reset}`);
      console.log(`${colors.cyan}WRAP${colors.reset}`);
      console.log(`${colors.cyan}------------------------${colors.reset}`);
      for (let i = 0; i < numWraps; i++) {
        await wrapPHRS(wallet, provider, i);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
      }

      console.log(`\n${colors.cyan}------------------------${colors.reset}`);
      console.log(`${colors.cyan}SWAP${colors.reset}`);
      console.log(`${colors.cyan}------------------------${colors.reset}`);
      for (let i = 0; i < numSwaps; i++) {
        await performSwap(wallet, provider, i);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
      }

      console.log(`\n${colors.cyan}------------------------${colors.reset}`);
      console.log(`${colors.cyan}ADD LP${colors.reset}`);
      console.log(`${colors.cyan}------------------------${colors.reset}`);
      for (let i = 0; i < numLPs; i++) {
        await addLiquidity(wallet, provider, i);
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
