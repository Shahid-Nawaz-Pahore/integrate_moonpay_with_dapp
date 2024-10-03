import dotenv from 'dotenv';
import express from 'express';
import { ethers } from 'ethers';
import { MoonPay } from '@moonpay/moonpay-node';
import { NFT, MARKETPLACE } from './nftabi.js';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());

// Ethereum setup
const provider = new ethers.providers.JsonRpcProvider(process.env.INFURA_API_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contractAddress = process.env.NFTAddress;
const marketplaceContractAddress = process.env.MARKETPLACEAddress;
const nftContract = new ethers.Contract(contractAddress, NFT, wallet);
const marketplaceContract = new ethers.Contract(marketplaceContractAddress, MARKETPLACE, wallet);

// MoonPay setup
const moonPay = new MoonPay(process.env.MOONPAY_SECRET_KEY);

// Function to get the current ETH price in EUR from MoonPay
const getCurrentEthPriceInEur = async () => {
  try {
    const response = await axios.get(`https://api.moonpay.com/v3/currencies`);
    const currencies = response.data;

    const ethCurrency = currencies.find(currency => currency.code === 'eth');
    const eurCurrency = currencies.find(currency => currency.code === 'eur');
    console.log("ethCurrency.price",ethCurrency.price)
    console.log("eurCurrency.price", eurCurrency.price)
    if (ethCurrency && eurCurrency) {
      const ethPriceInEur = ethCurrency.price / eurCurrency.price; // Calculate ETH price in EUR
      return ethPriceInEur;
    } else {
      throw new Error('ETH or EUR currency not found');
    }
  } catch (error) {
    console.error('Error fetching ETH price from MoonPay:', error);
    throw new Error('Unable to fetch ETH price');
  }
};


// New API endpoint to get the current ETH price in EUR
app.get('/current-eth-price', async (req, res) => {
  try {
    const ethPriceInEur = await getCurrentEthPriceInEur();
    res.status(200).json({ ethPriceInEur });
  } catch (error) {
    console.error('Error fetching current ETH price:', error);
    res.status(500).json({ error: 'Failed to fetch current ETH price' });
  }
});

// Route to buy ETH with Euros
app.get('/buy-eth', async (req, res) => {
  const { walletAddress, amount, email } = req.query;

  if (!walletAddress || !amount || !email) {
    return res.status(400).json({ error: 'walletAddress, amount, and email are required' });
  }

  const params = {
    apiKey: process.env.MOONPAY_API_KEY,
    baseCurrencyCode: 'EUR',
    currencyCode: 'eth',
    walletAddress: walletAddress,
    baseCurrencyAmount: amount,
    email: email,
    paymentMethod: 'credit_debit_card',
    redirectURL: 'http://localhost:3000/transaction',
  };

  try {
    const signedURL = moonPay.url.generate({ flow: 'buy', params });
    res.json({ signedURL });
  } catch (error) {
    console.error('Error generating MoonPay URL:', error);
    res.status(500).json({ error: 'Failed to generate MoonPay URL' });
  }
});

// Transaction callback route
app.get('/transaction', (req, res) => {
  const { transactionId, transactionStatus } = req.query;

  if (transactionStatus === 'completed') {
    res.send(`Transaction ${transactionId} completed successfully!`);
  } else {
    res.send(`Transaction ${transactionId} status: ${transactionStatus}`);
  }
});

// Fetch listed NFTs from the marketplace
app.get('/listed-nfts', async (req, res) => {
  try {
    const listedNFTs = await marketplaceContract.getAllListedNFTs();
    const result = listedNFTs.map(nft => ({
      seller: nft.seller,
      price: ethers.utils.formatEther(nft.price), // Format price from wei to ETH
      tokenId: nft.tokenId,
      nftContract: nft.nftContract,
      isListed: nft.isListed,
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching listed NFTs:', error);
    res.status(500).json({ error: 'Error fetching listed NFTs' });
  }
});

// Route to mint an NFT
app.post('/mint', async (req, res) => {
  try {
    const { walletAddress, tokenURI } = req.body;
    if (!walletAddress || !tokenURI) {
      return res.status(400).json({ error: 'Wallet address and token URI are required' });
    }

    const tx = await nftContract.safeMint(tokenURI, { from: walletAddress });
    await tx.wait();

    res.status(200).json({ message: 'NFT minted successfully!', txHash: tx.hash });
  } catch (error) {
    console.error('Minting error:', error);
    res.status(500).json({ error: 'Minting failed' });
  }
});

// Route to approve an NFT for transfer
app.post('/approve', async (req, res) => {
  try {
    const { walletAddress, operator, tokenId } = req.body;
    if (!walletAddress || !operator || !tokenId) {
      return res.status(400).json({ error: 'Wallet address, operator, and tokenId are required' });
    }

    const tx = await nftContract.approve(operator, tokenId, { from: walletAddress });
    await tx.wait();

    res.status(200).json({ message: 'NFT approved successfully!', txHash: tx.hash });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Handle MoonPay webhook notifications
app.post('/moonpay-webhook', express.json(), async (req, res) => {
  const { status, walletAddress, currencyCode } = req.body;

  if (status === 'completed' && currencyCode === 'eth') {
    try {
      const balance = await provider.getBalance(walletAddress);
      const nftPriceInEth = ethers.utils.parseEther('0.05'); // Define how much ETH the user needs to buy the NFT

      if (balance.gte(nftPriceInEth)) {
        return res.status(200).json({ message: 'Payment successful, user can proceed with NFT purchase!' });
      } else {
        return res.status(400).json({ error: 'Insufficient ETH balance' });
      }
    } catch (error) {
      console.error('Error in webhook:', error);
      return res.status(500).json({ error: 'Error handling MoonPay transaction' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid MoonPay transaction' });
  }
});

// Route to buy an NFT
app.post('/buy-nft', async (req, res) => {
  try {
    const { walletAddress, tokenId, nftContractAddress, priceInEur } = req.body;
    if (!walletAddress || !tokenId || !priceInEur || !nftContractAddress) {
      return res.status(400).json({ error: 'Wallet address, tokenId, priceInEur, and nftContractAddress are required' });
    }

    // Fetch the current ETH price in EUR
    const ethPriceInEur = await getCurrentEthPriceInEur();
    const nftPriceInEth = ethers.utils.parseEther((priceInEur / ethPriceInEur).toFixed(18)); // Convert price from EUR to ETH

    const balance = await provider.getBalance(walletAddress);

    if (balance.gte(nftPriceInEth)) {
      const tx = await marketplaceContract.buyNFT(nftContractAddress, tokenId, { value: nftPriceInEth, from: walletAddress });
      await tx.wait();

      return res.status(200).json({ message: 'NFT purchased successfully!', txHash: tx.hash });
    } else {
      return res.status(400).json({ error: 'Insufficient ETH balance to purchase the NFT' });
    }
  } catch (error) {
    console.error('NFT purchase error:', error);
    res.status(500).json({ error: 'NFT purchase failed' });
  }
});

// Start server
app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
