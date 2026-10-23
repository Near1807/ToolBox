// Stands in for whisper.cpp's whisper-server in the tests: same arguments,
// answers POST /inference with {"text": …} (the size of the uploaded file).
import process from 'node:process';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const language = args[args.indexOf('-l') + 1];
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/inference') {
    let size = 0;
    req.on('data', (chunk) => (size += chunk.length));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          text: ` [BLANK_AUDIO] bonjour (${language}, ${size > 1000 ? 'audio reçu' : 'vide'}) `,
        }),
      );
    });
    return;
  }
  res.end('<html>whisper.cpp server</html>');
}).listen(port, '127.0.0.1');
