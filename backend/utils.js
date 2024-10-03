// Fetch ETH to EUR conversion rate
async function fetchEthToEurRate() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
      return response.data.ethereum.eur;
    } catch (error) {
      console.error('Error fetching ETH to EUR rate:', error);
      throw new Error('Unable to fetch exchange rate');
    }
  }
  