import type { Plugin } from '@yarnpkg/core'

import { LicensesAuditCommand } from './commands/licensesAudit'
import { LicensesGenerateDisclaimerCommand } from './commands/licensesGenerateDisclaimer'
import { LicensesListCommand } from './commands/licensesList'

const plugin: Plugin = {
  commands: [LicensesListCommand, LicensesGenerateDisclaimerCommand, LicensesAuditCommand],
}

export default plugin
