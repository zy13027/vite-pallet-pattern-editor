// Import your own global styles (if you have them)
import './style.css'

// Import your Pallet Editor logic (you will create this file later)
import { initPalletEditor } from './palletEditor.js'

// Initialize your app inside the #app div
document.querySelector('#app').innerHTML = `
  <div class="editor-container">
    <h1>Pallet Pattern Editor</h1>
    <canvas id="palletCanvas"></canvas>
    <div id="controls"></div>
  </div>
`

// Start your specific logic
initPalletEditor(document.querySelector('#palletCanvas'))