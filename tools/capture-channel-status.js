// capture-channel-status.js
// Logs every raw stanza the bot receives/sends into capture.log so the real
// "Channel Status" wire format can be inspected.
//
// Usage: in your bot, right after you create the socket:
//
//   import { attachCapture } from 'fixo-baileys/tools/capture-channel-status.js'
//   const sock = makeWASocket({ ... })
//   attachCapture(sock)
//
// Then post a real Channel Status from the phone (one text, one photo)
// and send capture.log back (remove phone numbers if you like).
import fs from 'fs'
import { binaryNodeToString } from '../lib/WABinary/index.js'

export const attachCapture = (sock, file = 'capture.log') => {
    const out = fs.createWriteStream(file, { flags: 'a' })
    sock.ws.on('frame', (frame) => {
        if (frame instanceof Uint8Array) return
        // skip noisy keep-alive / presence traffic
        if (['presence', 'chatstate', 'receipt', 'ack'].includes(frame.tag)) return
        try {
            out.write(`\n[${new Date().toISOString()}] RECV\n${binaryNodeToString(frame)}\n`)
        } catch (e) {
            out.write(`\n[${new Date().toISOString()}] RECV (unprintable) ${e.message}\n`)
        }
    })
    console.log(`capture started -> ${file}`)
}
