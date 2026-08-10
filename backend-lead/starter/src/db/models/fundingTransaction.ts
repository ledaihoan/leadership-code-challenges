import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingTxType = 'deposit' | 'withdrawal';
export type FundingTxStatus = 'Pending' | 'Completed' | 'Failed';

export class FundingTransaction extends Model {
  declare id: string;
  declare walletId: string;
  declare type: FundingTxType;
  declare status: FundingTxStatus;
  declare amount: string;
  declare turnoverMultiplier: number;
  declare pspRef: string | null;
  declare creditedAmount: string | null;
  declare amountMismatch: boolean;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Pending' },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      pspRef: { type: DataTypes.STRING, allowNull: true },
      creditedAmount: { type: DataTypes.DECIMAL(36, 18), allowNull: true },
      amountMismatch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}
