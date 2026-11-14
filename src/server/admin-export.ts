import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { creditLedger, creditOrders, users } from '../db/schema';
import {
  adminAdjustCategoryLabels,
  ledgerReasonLabels,
  orderStatusLabels,
} from '../domain/admin-labels';
import type { AdminListQuery } from './admin-list';
import { orderFiltersWhere } from './admin-list';

const PAGE = 50;
const MAX_ROWS = 5_000;

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function adminLedgerExportCsv(
  db: Database,
  query: AdminListQuery,
): Promise<string> {
  const lines = ['tanggal,email,nama,alasan,kategori,jumlah,catatan'];
  const filters = query.userId
    ? eq(creditLedger.userId, query.userId)
    : undefined;
  let offset = 0;
  let rows = 0;
  while (rows < MAX_ROWS) {
    const batch = await db
      .select({
        amount: creditLedger.amount,
        reason: creditLedger.reason,
        note: creditLedger.note,
        category: creditLedger.category,
        createdAt: creditLedger.createdAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(creditLedger)
      .innerJoin(users, eq(creditLedger.userId, users.id))
      .where(filters)
      .orderBy(desc(creditLedger.createdAt))
      .limit(PAGE)
      .offset(offset);
    if (batch.length === 0) break;
    for (const row of batch) {
      const label = ledgerReasonLabels[row.reason] ?? row.reason;
      const category = row.category
        ? (adminAdjustCategoryLabels[row.category] ?? row.category)
        : '';
      const note = row.note ?? '';
      lines.push(
        `${csvCell(row.createdAt)},${csvCell(row.userEmail)},${csvCell(row.userName)},${csvCell(label)},${csvCell(category)},${row.amount},${csvCell(note)}`,
      );
    }
    rows += batch.length;
    offset += batch.length;
    if (batch.length < PAGE) break;
  }
  return `${lines.join('\n')}\n`;
}

export async function adminOrdersExportCsv(
  db: Database,
  query: AdminListQuery,
): Promise<string> {
  const lines = [
    'tanggal,email,nama,status,pesanan_id,paket,kredit,idr,dibayar',
  ];
  const where = orderFiltersWhere(query);
  let offset = 0;
  let rows = 0;
  while (rows < MAX_ROWS) {
    const batch = await db
      .select({
        orderId: creditOrders.orderId,
        packId: creditOrders.packId,
        credits: creditOrders.credits,
        amountIdr: creditOrders.amountIdr,
        status: creditOrders.status,
        createdAt: creditOrders.createdAt,
        paidAt: creditOrders.paidAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(creditOrders)
      .innerJoin(users, eq(creditOrders.userId, users.id))
      .where(where)
      .orderBy(desc(creditOrders.createdAt))
      .limit(PAGE)
      .offset(offset);
    if (batch.length === 0) break;
    for (const row of batch) {
      const status = orderStatusLabels[row.status] ?? row.status;
      lines.push(
        `${csvCell(row.createdAt)},${csvCell(row.userEmail)},${csvCell(row.userName)},${csvCell(status)},${csvCell(row.orderId)},${csvCell(row.packId)},${row.credits},${row.amountIdr},${csvCell(row.paidAt ?? '')}`,
      );
    }
    rows += batch.length;
    offset += batch.length;
    if (batch.length < PAGE) break;
  }
  return `${lines.join('\n')}\n`;
}
