import React, { Component } from 'react'

import { Text, TouchableHighlight, View, Image } from 'react-native'
import Button from 'ui/components/button'

import Friend from 'lndr/friend'
import profilePic from 'lndr/profile-pic'

import style from 'theme/account'
import general from 'theme/general'
import friendStyle from 'theme/friend'

import language from 'language'
const { addFriendButton } = language

interface Props {
  onPress: () => void
  friend: Friend
  selected? : boolean
}

interface State {
  pic?: string
}

let unmounting = false;

export default class AddFriendRow extends Component<Props, State> {
  constructor(props) {
    super(props)
    this.state = {}
  }

  async componentWillMount() {
    const { friend, selected } = this.props
    let pic

    unmounting = false;

    try {
      pic = await profilePic.get(friend.address)
    } catch (e) {}
    
    if ((!unmounting || selected) && pic) {
      this.setState({ pic })
    }
  }

  componentWillUnmount() {
    unmounting = true;
  }

  addFriendButton() {
    const { onPress } = this.props
    //need check to see if person is friend
    return <Button small round friend onPress={onPress} text={addFriendButton} style={{marginRight: 10}} />
  }

  render() {
    const { friend, selected, onPress } = this.props
    const { pic } = this.state
    const imageSource = pic ? { uri: pic } : require('images/person-outline-dark.png')
    
    return (
      <TouchableHighlight onPress={onPress}>
        <View style={friendStyle.searchRow} >
          <View style={style.pendingTransactionRow}>
            <View style={[general.flexRow, general.alignCenter]}>
              <Image source={imageSource} style={style.friendIcon}/>
              <View style={general.flexColumn}>
                <Text style={style.titledPending}>{`@${friend.nickname}`}</Text>
              </View>
            </View>
            {!selected && this.addFriendButton()}
          </View>
        </View>
      </TouchableHighlight>
    )
  }
}
