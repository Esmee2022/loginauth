const { spawn } = require('child_process');

async function test() {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const proc = spawn(edge, [
    '--headless',
    '--remote-debugging-port=9225',
    'http://127.0.0.1:3000/index.html'
  ]);

  setTimeout(async () => {
    try {
      const list = await (await fetch('http://127.0.0.1:9225/json')).json();
      const page = list.find(t => t.url.includes('index.html'));
      if (!page) {
        console.log('Page not found');
        proc.kill();
        return;
      }
      
      const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              const input = document.getElementById('loginIdentifier');
              const rect = input ? input.getBoundingClientRect() : null;
              const el = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
              const signupPanel = document.querySelector('.signup-panel');
              const loginPanel = document.querySelector('.login-panel');
              return {
                inputFound: !!input,
                rect: rect,
                topElementAtCenter: el ? (el.tagName + '.' + el.className + (el.id ? '#' + el.id : '')) : null,
                isInputClickable: el === input,
                signupZIndex: getComputedStyle(signupPanel).zIndex,
                loginZIndex: getComputedStyle(loginPanel).zIndex
              };
            })()`,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = (msg) => {
        const res = JSON.parse(msg.data);
        console.log('RAW CDP RESPONSE:', JSON.stringify(res, null, 2));
        proc.kill();
        process.exit(0);
      };
    } catch (e) {
      console.error('Error:', e);
      proc.kill();
      process.exit(1);
    }
  }, 1200);
}

test();
