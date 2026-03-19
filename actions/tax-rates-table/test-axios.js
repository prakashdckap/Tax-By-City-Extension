const axios = require('axios');

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/tax-rates-table',
  headers: {
    'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
  }
};

axios.request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    console.log(error.response?.status, error.response?.data || error.message);
  });
