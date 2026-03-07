import { UniversalConnector } from '@reown/appkit-universal-connector'
import { createAppKit } from '@reown/appkit'

// Expose to window so the existing non-module index.js can call these
window.ReownAppKit = { createAppKit, UniversalConnector }

// Dynamic import ensures hathor-wallet.js runs after window.ReownAppKit is set.
// Static imports are hoisted and would execute hathor-wallet.js before the assignment above.
import('./hathor-wallet.js')
