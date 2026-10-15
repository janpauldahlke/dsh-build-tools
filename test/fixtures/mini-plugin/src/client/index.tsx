/** Fixture client half: React face (jsx automatic path). */
import { createElement } from 'react'

export function Mini(): unknown {
  return createElement('div', null, 'mini-plugin-client')
}

export const clientMarker = 'mini-plugin-client'
