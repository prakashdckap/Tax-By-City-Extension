const https = require('https');

function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'POST',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: responseData,
          headers: res.headers
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function main(params) {
  try {
    // Parse request body
    let requestBody = {};
    if (params["__ow_body"]) {
      try {
        requestBody = typeof params["__ow_body"] === 'string' 
          ? JSON.parse(params["__ow_body"]) 
          : params["__ow_body"];
      } catch (e) {
        requestBody = params["__ow_body"];
      }
    } else if (params.taxRate || params.region) {
      requestBody = {
        taxRate: params.taxRate || {},
        region: params.region || 'amer'
      };
    }

    // Validate required fields
    if (!requestBody.taxRate) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'taxRate is required in request body'
        }
      };
    }

    const raw = JSON.stringify(requestBody);
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
    };

    const response = await makeRequest(
      'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/manage-tax-rate?result=true&blocking=true',
      { method: 'POST', headers: headers },
      raw
    );
    
    let resultData;
    try {
      resultData = JSON.parse(response.data);
    } catch (e) {
      resultData = response.data;
    }

    return {
      statusCode: response.status || 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        result: resultData,
        message: 'Tax rate saved successfully'
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: error.message || 'Internal server error'
      }
    };
  }
}

exports.main = main;