import type { Plugin } from '@yarnpkg/core'

import { LicensesGenerateDisclaimerCommand } from './commands/licensesGenerateDisclaimer'
import { LicensesListCommand } from './commands/licensesList'

const plugin: Plugin = {
  commands: [LicensesListCommand, LicensesGenerateDisclaimerCommand],
}

export default plugin
