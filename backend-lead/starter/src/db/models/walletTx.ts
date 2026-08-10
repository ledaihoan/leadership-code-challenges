import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxKind = 'deposit_credit' | 'wager_debit' | 'withdrawal_debit';

// Append-only ledger. Rows are never updated or deleted.
export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  declare fundingTxId: string | null;
  declare kind: WalletTxKind;
  declare amount: string; // signed: credit +, debit -
  declare balanceAfter: string;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      fundingTxId: { type: DataTypes.UUID, allowNull: true },
      kind: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false },
  );
}
