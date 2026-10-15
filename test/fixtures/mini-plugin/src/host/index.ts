/**
 * Fixture host half: keeps a cordis import (must stay external in the output)
 * and a pure export (must be bundled).
 */
import { definePlugin } from '@deepseek-ai/cordis'

export const hostMarker = 'mini-plugin-host'

export default definePlugin(() => hostMarker)
