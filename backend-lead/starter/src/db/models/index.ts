import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { FundingTransaction, initFundingTransaction } from './fundingTransaction';
import { WalletTx, initWalletTx } from './walletTx';
import { PspCallbackEvent, initPspCallbackEvent } from './pspCallbackEvent';

initMember(sequelize);
initWallet(sequelize);
initFundingTransaction(sequelize);
initWalletTx(sequelize);
initPspCallbackEvent(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

Wallet.hasMany(FundingTransaction, { foreignKey: 'walletId', as: 'fundingTransactions' });
FundingTransaction.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });

Wallet.hasMany(WalletTx, { foreignKey: 'walletId', as: 'ledger' });
WalletTx.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
WalletTx.belongsTo(FundingTransaction, { foreignKey: 'fundingTxId', as: 'fundingTx' });

PspCallbackEvent.belongsTo(FundingTransaction, { foreignKey: 'fundingTxId', as: 'fundingTx' });

export { Member, Wallet, FundingTransaction, WalletTx, PspCallbackEvent };
