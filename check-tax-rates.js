const axios = require('axios');

// Call get-taxes API to list all tax rates
const config = {
  method: 'get',
  url: 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/get-taxes',
  headers: {
    'Content-Type': 'application/json'
  }
};

axios.request(config)
  .then((response) => {
    console.log('=== TAX RATES IN DATABASE ===\n');
    console.log('Total tax rates:', response.data.data?.length || 0);
    console.log('\n=== TAX RATES LIST ===\n');
    
    if (response.data.data && Array.isArray(response.data.data)) {
      response.data.data.forEach((rate, index) => {
        console.log(`${index + 1}. ID: ${rate._id}`);
        console.log(`   Country: ${rate.tax_country_id}, State: ${rate.tax_region_id}`);
        console.log(`   City: ${rate.city || 'N/A'}, ZIP: ${rate.tax_postcode || 'N/A'}`);
        console.log(`   Rate: ${rate.rate}%`);
        console.log(`   Magento ID: ${rate.tax_identifier || 'N/A'}`);
        console.log(`   Status: ${rate.status ? 'Active' : 'Inactive'}`);
        console.log(`   Created: ${rate.created_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('No tax rates found or unexpected response format');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    }
  })
  .catch((error) => {
    console.error('Error fetching tax rates:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
  });
