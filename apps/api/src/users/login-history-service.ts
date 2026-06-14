import { injectable, inject } from 'tsyringe';
import { LoginHistoryRepository, type LoginHistoryRow } from './login-history-repository';

const CSV_HEADERS = [
  'Logged In At (UTC)',
  'Email',
  'First Name',
  'Last Name',
  'IP Address',
  'User Agent',
];

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const needsQuoting = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

function rowToCsv(row: LoginHistoryRow): string {
  return [
    row.loggedInAt.toISOString(),
    row.email,
    row.firstName,
    row.lastName,
    row.ipAddress,
    row.userAgent,
  ]
    .map(escapeCsvField)
    .join(',');
}

@injectable()
export class LoginHistoryService {
  constructor(
    @inject(LoginHistoryRepository)
    private loginHistoryRepository: LoginHistoryRepository
  ) {}

  async exportLast30DaysCsv(tenantId: string): Promise<string> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.loginHistoryRepository.findByTenantInRange(
      tenantId,
      startDate,
      endDate
    );

    const lines = [CSV_HEADERS.map(escapeCsvField).join(',')];
    for (const row of rows) {
      lines.push(rowToCsv(row));
    }
    return lines.join('\r\n') + '\r\n';
  }
}
