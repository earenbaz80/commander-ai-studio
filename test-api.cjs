const http = require('http');
http.get('http://localhost:3000/api/plugins', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', d));
}).on('error', e => console.error('Error:', e.message))