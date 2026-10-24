// Stands in for whisper.cpp's whisper-server in the tests: same arguments,
// answers POST /inference with {"text": …} (the size of the uploaded file, and
// the « prompt » field when one was sent).
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const language = args[args.indexOf('-l') + 1];
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/inference') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const prompt = /name="prompt"\r\n\r\n([^\r]*)/.exec(body.toString('utf8'))?.[1];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          text: ` [BLANK_AUDIO] bonjour (${language}, ${body.length > 1500 ? 'audio reçu' : 'vide'}${prompt ? `, mots : ${prompt}` : ''}) `,
        }),
      );
    });
    return;
  }
  res.end('<html>whisper.cpp server</html>');
}).listen(port, '127.0.0.1');
