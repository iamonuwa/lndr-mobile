import ethUtil from 'ethereumjs-util'
import { UrbanAirship } from 'urbanairship-react-native'

import { longTimePeriod } from 'lndr/time'
import Balance from 'lndr/balance'
import User, { CreateAccountData, RecoverAccountData, LoginAccountData, UpdateAccountData } from 'lndr/user'
import { minimumNicknameLength, minimumPasswordLength } from 'lndr/user'
import Friend from 'lndr/friend'
import PendingTransaction from 'lndr/pending-transaction'
import RecentTransaction from 'lndr/recent-transaction'
import ucac from 'lndr/ucac'

import CreditProtocol from 'credit-protocol'

import Storage from 'lndr/storage'

import { accountManagement, debtManagement } from 'language'

import { ToastActionsCreators } from 'react-native-redux-toast'
import { getUser, getStore } from 'reducers/app'

const bcrypt = require('bcryptjs')

const mnemonicStorage = new Storage('mnemonic')
const hashedPasswordStorage = new Storage('hashed-password')

const creditProtocol = new CreditProtocol('http://34.238.20.130')

// TODO REMOVE setState FUNCTION as the sole purpose was to transition from using
// the custom engine design to redux storage
const setState = (payload) => (
  { type: 'SET_STATE', payload: payload }
)

export const initializeStorage = () => {
  return async (dispatch) => {
    const storedMnemonic = await mnemonicStorage.get()
    if (storedMnemonic) {
      dispatch(setState({ hasStoredUser: true, welcomeComplete: true }))
    }
    dispatch(setState({ isInitializing: false }))
  }
}

export const mnemonicDisplayed = () => {
  const payload = { shouldDisplayMnemonic: false }
  return setState(payload)
}

export const displayError = (error: string) => {
  return ToastActionsCreators.displayError(error)
}

export const displaySuccess = (success: string) => {
  return ToastActionsCreators.displayInfo(success)
}

export const updateAccount = (accountData: UpdateAccountData) => {
  return async (dispatch, getState) => {
    const { address, privateKeyBuffer } = getUser(getState())()
    const { nickname } = accountData

    try {
      await creditProtocol.setNickname(address, nickname, privateKeyBuffer)
      dispatch(displaySuccess(accountManagement.setNickname.success))
      dispatch(getAccountInformation())
    } catch (error) {
      dispatch(displayError(accountManagement.setNickname.error))
      throw error
    }
  }
}

export const registerChannelID = (channelID: string, platform: string) => {
  return async (_dispatch, getState) => {
    const { address } = getUser(getState())()
    creditProtocol.registerChannelID(address, channelID, platform)
  }
}

//Not a redux action
export async function storeUserSession(user: User) {
  await mnemonicStorage.set(user.mnemonic)
  await hashedPasswordStorage.set(user.hashedPassword)
}

//Not a redux action
export const createUserFromCredentials = (mnemonic, hashedPassword) => {
  const mnemonicInstance = creditProtocol.getMnemonic(mnemonic)
  const privateKey = mnemonicInstance.toHDPrivateKey()
  const privateKeyBuffer = privateKey.privateKey.toBuffer()
  const ethAddress = ethUtil.privateToAddress(privateKeyBuffer)
  const address = ethAddress.toString('hex')

  return new User(
    mnemonic,
    hashedPassword,
    privateKey,
    privateKeyBuffer,
    ethAddress,
    address
  )
}

export const confirmAccount = () => {
  return async (dispatch, getState) => {
    const { password, mnemonic } = getStore(getState())()
    const hashedPassword = bcrypt.hashSync(password)

    const user = createUserFromCredentials(mnemonic, hashedPassword)
    await storeUserSession(user)
    const payload = { user, hasStoredUser: true }
    dispatch(setState(payload))
  }
}

export const createAccount = (accountData: CreateAccountData) => {
  return async (dispatch) => {
    if (accountData.password.length < minimumPasswordLength) {
      return dispatch(displayError(accountManagement.password.lengthViolation))
    }
    if (accountData.password !== accountData.confirmPassword) {
      return dispatch(displayError(accountManagement.password.matchViolation))
    }
    if (accountData.nickname.length < minimumNicknameLength) {
      return dispatch(displayError(accountManagement.nickname.lengthViolation))
    }
    if(accountData.nickname.match(/^[a-z0-9]*$/) === null) {
      return dispatch(displayError(accountManagement.nickname.compositionViolation))
    }

    const password = accountData.password
    const mnemonic = creditProtocol.getRandomMnemonic().toString()
    const payload = { shouldDisplayMnemonic: true, password: password, mnemonic }
    dispatch(setState(payload))
    dispatch(await confirmAccount())
    dispatch(await updateAccount({nickname: accountData.nickname}))
  }
}

//Not a redux action
export async function getNicknameForAddress(address) {
  try {
    return await creditProtocol.getNickname(address)
  }
  catch (e) {
    return address.substr(0, 8)
  }
}

//Not a redux action
export async function getTwoPartyBalance(user: User, friend: Friend) {
  const { address } = user
  const amount = await creditProtocol.getBalanceBetween(address, friend.address)
  return new Balance({ relativeToNickname: friend.nickname, relativeTo: friend.address, amount: amount })
}

export const getBalances = () => {
  return async (dispatch, getState) => {
    const { address } = getUser(getState())()
    const rawCounterparties = await creditProtocol.getCounterparties(address)
    const uniqueCounterparties = {}
    const balances: Balance[] = []

    await Promise.all(
      rawCounterparties.map(async (rawCounterparty) => {
        const counterpartyAddress = rawCounterparty.replace('0x', '')
        if (!(counterpartyAddress in uniqueCounterparties)) {
          uniqueCounterparties[counterpartyAddress] = true
          try {
            const amount = await creditProtocol.getBalanceBetween(address, counterpartyAddress)
            const relativeToNickname = await getNicknameForAddress(counterpartyAddress)
            balances.push(new Balance({ relativeToNickname, relativeTo: counterpartyAddress, amount }))
          }
          catch (e) {
            dispatch(displayError(debtManagement.balances.error))
          }
        }
      })
    )
    dispatch(setState({ balances, balancesLoaded: true }))
  }
}

//Needs a selector
export const getAccountInformation = () => {
  return async (dispatch, getState) => {
    const { address } = getUser(getState())()
    const accountInformation: { nickname?: string, balance?: number } = {}
    try {
      accountInformation.nickname = await creditProtocol.getNickname(address)
    }
    catch (e) {}
    try {
      accountInformation.balance = await creditProtocol.getBalance(address)
    }
    catch (e) {}
    dispatch(setState({ accountInformation, accountInformationLoaded: true }))
    return accountInformation
  }
}

//Not a redux action
export async function takenNick(nickname: string) {
  let result = false
  if (nickname.length >= minimumNicknameLength) {
    result = await creditProtocol.takenNick(nickname)
  }
  return result
}

export const addFriend = (friend: Friend) => {
  return async (dispatch, getState) => {
    const { address/*, privateKeyBuffer*/ } = getUser(getState())()
    try {
      await creditProtocol.addFriend(address, friend.address/*, privateKeyBuffer*/)
      dispatch(displaySuccess(accountManagement.addFriend.success(friend.nickname)))
    } catch (error) {
      dispatch(displayError(accountManagement.addFriend.error))
      throw error
    }
  }
}

export const removeFriend = (friend: Friend) => {
  return async (dispatch, getState) => {
    const { address/*, privateKeyBuffer*/ } = getUser(getState())()
    try {
      await creditProtocol.removeFriend(address, friend.address/*, privateKeyBuffer*/)
      dispatch(displaySuccess(accountManagement.removeFriend.success(friend.nickname)))
    } catch (error) {
      dispatch(displayError(accountManagement.removeFriend.error))
      throw error
    }
  }
}

//Not a redux action
export const jsonToFriend = (data) => {
  let addr, nick
  if (typeof data === 'string') {
    addr = data
    nick = addr.substr(2, 8)
  }
  else {
    addr = data.addr
    nick = data.nick || addr.substr(2, 8)
  }
  return new Friend(addr, nick)
}

//Not a redux action
export async function ensureNicknames(friends: Friend[]) {
  const needNicknamesFor = friends.filter(
    friend => !friend.nickname || friend.nickname === 'N/A'
  )

  await Promise.all(
    needNicknamesFor.map(
      async (friend) => {
        const nickname = await creditProtocol.getNickname(friend.address)
        friend.nickname = nickname
      }
    )
  )
}

//Not a redux action
export async function ensureTransactionNicknames(transactions: Array<PendingTransaction|RecentTransaction>) {
  const needNicknamesFor = transactions.filter(
    transaction => !transaction.creditorNickname || !transaction.debtorNickname
  )

  await Promise.all(
    needNicknamesFor.map(
      async (transaction) => {
        transaction.creditorNickname = await getNicknameForAddress(transaction.creditorAddress)
        transaction.debtorNickname = await getNicknameForAddress(transaction.debtorAddress)
      }
    )
  )
}

export const getFriends = () => {
  return async (dispatch, getState) => {
    const { address } = getUser(getState())()
    const friends = await creditProtocol.getFriends(address)
    const result = friends.map(jsonToFriend)
    await ensureNicknames(result)
    return dispatch(setState({ friends: result, friendsLoaded: true }))
  }
}

//Not a redux action
export async function searchUsers(searchData) {
  const { nickname } = searchData
  if (nickname.length >= minimumNicknameLength) {
    const users = await creditProtocol.searchUsers(nickname)
    return users.map(jsonToFriend)
  } else {
    return []
  }
}

//Not a redux action
export const jsonToPendingTransaction = (data) => {
  return new PendingTransaction(data)
}

//Not a redux action
export const jsonToRecentTransaction = (data) => {
  return new RecentTransaction(data)
}

export const getRecentTransactions = () => {
  return async (dispatch, getState) => {
    const { address } = getUser(getState())()
    const rawRecentTransactions = await creditProtocol.getTransactions(address)
    const recentTransactions = rawRecentTransactions.map(jsonToRecentTransaction)
    await ensureTransactionNicknames(recentTransactions)
    dispatch(setState({ recentTransactions, recentTransactionsLoaded: true }))
  }
}

export const getPendingTransactions = () => {
  return async (dispatch, getState) => {
    const { address } = getUser(getState())()
    const rawPendingTransactions = await creditProtocol.getPendingTransactions(address)
    const pendingTransactions = rawPendingTransactions.map(jsonToPendingTransaction)
    await ensureTransactionNicknames(pendingTransactions)
    dispatch(setState({ pendingTransactions, pendingTransactionsLoaded: true }))
  }
}

export const confirmPendingTransaction = (pendingTransaction: PendingTransaction) => {
  return async (dispatch, getState) => {
    const { creditorAddress, debtorAddress, amount, memo } = pendingTransaction
    const { address, privateKeyBuffer } = getUser(getState())()
    const direction = address === creditorAddress ? 'lend' : 'borrow'

    try {
      const creditRecord = await creditProtocol.createCreditRecord(
        ucac,
        creditorAddress,
        debtorAddress,
        amount,
        memo
      )

      const signature = creditRecord.sign(privateKeyBuffer)
      await creditProtocol.submitCreditRecord(creditRecord, direction, signature)

      dispatch(displaySuccess(debtManagement.confirmation.success))
      return true
    }

    catch (e) {
      dispatch(displayError(debtManagement.confirmation.error))
      return false
    }
  }
}

export const rejectPendingTransaction = (pendingTransaction: PendingTransaction) => {
  return async (dispatch, getState) => {
    const { address, privateKeyBuffer } = getUser(getState())()
    const { hash } = pendingTransaction
    try {
      await creditProtocol.rejectPendingTransactionByHash(hash, privateKeyBuffer)

      dispatch(displaySuccess(debtManagement.rejection.success))
      return true
    }
    catch (e) {
      dispatch(displayError(debtManagement.rejection.error))
      return false
    }
  }
}

export const addDebt = (friend: Friend, amount: string, memo: string, direction: string) => {
  return async (dispatch, getState) => {
    const { address, privateKeyBuffer } = getUser(getState())()

    if (!friend) {
      return dispatch(displayError('Friend must be selected'))
    }

    if (!amount) {
      return dispatch(displayError('Amount must be entered'))
    }

    const sanitizedAmount = parseInt(
      amount
      .replace(/[^.\d]/g, '')
      .replace(/^\d+\.?$/, x => `${x}00`)
      .replace(/\.\d$/, x => `${x.substr(1)}0`)
      .replace(/\.\d\d$/, x => `${x.substr(1)}`)
      .replace(/\./, () => '')
    )

    if (sanitizedAmount <= 0) {
      return dispatch(displayError('Amount must be greater than $0'))
    }

    if (sanitizedAmount >= 1e11) {
      return dispatch(displayError('Amount must be less than $1,000,000,000'))
    }

    if (!memo) {
      return dispatch(displayError('Memo must be entered'))
    }

    if (!direction) {
      return dispatch(displayError('Please choose the correct statement to determine the creditor and debtor'))
    }

    if (address === friend.address) {
      return dispatch(displayError('You can\'t create debt with yourself, choose another friend'))
    }

    // TODO - Please move this to validation check to the view layer and in favor of using the getPendingTransaction action
    const rawPendingTransactions = await creditProtocol.getPendingTransactions(address)
    const pendingTransactions = rawPendingTransactions.map(jsonToPendingTransaction)
    if(pendingTransactions.some( ele => ele.creditorAddress === address || ele.debtorAddress === address ) ) {
      return dispatch(displayError('Please resolve your pending transaction with this user before creating another'))
    }

    const [ creditorAddress, debtorAddress ] = {
      lend: [ address, friend.address ],
      borrow: [ friend.address, address ]
    }[direction]

    try {
      const creditRecord = await creditProtocol.createCreditRecord(
        ucac,
        creditorAddress,
        debtorAddress,
        sanitizedAmount,
        memo
      )

      const signature = creditRecord.sign(privateKeyBuffer)
      await creditProtocol.submitCreditRecord(creditRecord, direction, signature)

      dispatch(displaySuccess(debtManagement.pending.success(friend)))
      return true
    }

    catch (e) {
      dispatch(displayError(debtManagement.pending.error))
    }
  }
}

export const loginAccount = (loginData: LoginAccountData) => {
  return async (dispatch) => {
    const { confirmPassword } = loginData
    const hashedPassword = await hashedPasswordStorage.get()
    const passwordMatch = bcrypt.compareSync(confirmPassword, hashedPassword)
    if (!passwordMatch) {
      return dispatch(displayError(accountManagement.password.failedHashComparison))
    }

    const mnemonic = await mnemonicStorage.get()
    const user = createUserFromCredentials(mnemonic, hashedPassword)
    const payload = { user, hasStoredUser: true }
    dispatch(setState(payload))
    // getPendingTransactions(user) // why was this here?
  }
}

export const logoutAccount = () => {
  const payload = { user: undefined }
  return setState(payload)
}

export const recoverAccount = (recoverData: RecoverAccountData) => {
  return async (dispatch) => {
    const { confirmPassword, mnemonic } = recoverData

    if (mnemonic.split(' ').length < 12) {
      return dispatch(displayError(accountManagement.mnemonic.lengthViolation))
    }

    if (confirmPassword.length < minimumPasswordLength) {
      return dispatch(displayError(accountManagement.password.lengthViolation))
    }

    try {
      const payload = { password: confirmPassword, mnemonic: mnemonic.toLowerCase()}
      dispatch(setState(payload))
      dispatch(await confirmAccount())
    }

    catch (e) {
      dispatch(displayError(accountManagement.mnemonic.unableToValidate))
    }
  }
}

export const removeAccount = () => {
  return async (dispatch) => {
    await mnemonicStorage.remove()
    await hashedPasswordStorage.remove()
    const payload = { hasStoredUser: false, shouldRemoveAccount: false }
    dispatch(setState(payload))
  }
}

export const setAuthLoading = (state) => {
  const payload = { isAuthLoading: state }
  return setState(payload)
}

export const goToRecoverAccount = () => {
  const payload = { shouldRecoverAccount: true }
  return setState(payload)
}

export const cancelRecoverAccount = () => {
  const payload = { shouldRecoverAccount: false }
  return setState(payload)
}

export const goToRemoveAccount = () => {
  const payload = { shouldRemoveAccount: true }
  return setState(payload)
}

export const cancelRemoveAccount = () => {
  const payload = { shouldRemoveAccount: false }
  return setState(payload)
}

export const setWelcomeComplete = (state) => {
  const payload = { welcomeComplete: state }
  return setState(payload)
}