import React from 'react';
import reactMixin from 'react-mixin';
import autoBind from 'react-autobind';
import Reflux from 'reflux';
import TagsInput from 'react-tagsinput';
import Checkbox from 'js/components/checkbox';
import TextBox from 'js/components/textBox';
import {stores} from 'js/stores';
import {actions} from 'js/actions';
import {bem} from 'js/bem';
import {permParser} from './permParser';
import permConfig from './permConfig';
import {
  assign,
  t,
  notify,
  buildUserUrl
} from 'js/utils';
import {
  ANON_USERNAME,
  KEY_CODES,
  PERMISSIONS_CODENAMES
} from 'js/constants';

/**
 * Form for adding/changing user permissions for surveys.
 *
 * @prop uid - asset uid
 * @prop username - permissions user username (could be empty for new)
 * @prop permissions - list of permissions (could be empty for new)
 * @prop onSubmitEnd - callback to be run when submit ends (success or failure)
 */
class UserAssetPermsEditor extends React.Component {
  constructor(props) {
    super(props);
    autoBind(this);

    this.state = {
      // inner workings
      usernamesBeingChecked: new Set(),
      isSubmitPending: false,
      isEditingUsername: false,
      isAddingPartialUsernames: false,
      // form user inputs
      username: '',
      formView: false,
      formViewDisabled: false,
      formEdit: false,
      submissionsView: false,
      submissionsViewDisabled: false,
      submissionsViewPartial: false,
      submissionsViewPartialDisabled: false,
      submissionsViewPartialUsers: [],
      submissionsAdd: false,
      submissionsEdit: false,
      submissionsEditDisabled: false,
      submissionsValidate: false,
      submissionsValidateDisabled: false
    };

    this.applyPropsData();
  }

  /**
   * Fills up form with provided user name and permissions (if applicable)
   */
  applyPropsData() {
    if (this.props.permissions) {
      const formData = permParser.buildFormData(this.props.permissions);
      this.state = this.applyValidityRules(assign(this.state, formData));
    }

    if (this.props.username) {
      this.state.username = this.props.username;
    }
  }

  componentDidMount() {
    this.listenTo(actions.permissions.bulkSetAssetPermissions.completed, this.onBulkSetAssetPermissionCompleted);
    this.listenTo(actions.permissions.bulkSetAssetPermissions.failed, this.onBulkSetAssetPermissionFailed);
    this.listenTo(stores.userExists, this.onUserExistsStoreChange);
  }

  onBulkSetAssetPermissionCompleted() {
    this.setState({isSubmitPending: false});
    this.notifyParentAboutSubmitEnd(true);
  }

  onBulkSetAssetPermissionFailed() {
    this.setState({isSubmitPending: false});
    this.notifyParentAboutSubmitEnd(false);
  }

  notifyParentAboutSubmitEnd(isSuccess) {
    if (
      !this.state.isSubmitPending &&
      typeof this.props.onSubmitEnd === 'function'
    ) {
      this.props.onSubmitEnd(isSuccess);
    }
  }

  /**
   * Single callback for all checkboxes to keep the complex connections logic
   * being up to date regardless which one changed.
   */
  onCheckboxChange(id, isChecked) {
    // apply checked checkbox change to state
    const newState = this.state;
    newState[id] = isChecked;

    // reset partial inputs when unchecking `submissionsView`
    if (newState.submissionsView === false) {
      newState.submissionsViewPartial = false;
      newState.submissionsViewPartialUsers = [];
    }

    // needs to be called last
    this.setState(this.applyValidityRules(newState));
  }

  /**
   * Helps to avoid users submitting invalid data.
   *
   * Checking some of the checkboxes implies that other are also checked
   * and can't be unchecked.
   *
   * Checking some of the checkboxes implies that other can't be checked.
   *
   * @param {Object} state
   * @returns {Object} updated state
   */
  applyValidityRules(stateObj) {
    // reset disabling before checks
    stateObj.formViewDisabled = false;
    stateObj.submissionsViewDisabled = false;
    stateObj.submissionsViewPartialDisabled = false;
    stateObj.submissionsEditDisabled = false;
    stateObj.submissionsValidateDisabled = false;

    // checking these options implies having `formView` checked
    if (
      stateObj.formEdit ||
      stateObj.submissionsView ||
      stateObj.submissionsViewPartial ||
      stateObj.submissionsAdd ||
      stateObj.submissionsEdit ||
      stateObj.submissionsValidate
    ) {
      stateObj.formView = true;
      stateObj.formViewDisabled = true;
    }

    // checking these options implies having `submissionsView` checked
    if (
      stateObj.submissionsEdit ||
      stateObj.submissionsValidate
    ) {
      stateObj.submissionsView = true;
      stateObj.submissionsViewDisabled = true;
    }

    // checking `submissionsViewPartial` disallows checking two other options
    if (stateObj.submissionsViewPartial) {
      stateObj.submissionsEdit = false;
      stateObj.submissionsEditDisabled = true;
      stateObj.submissionsValidate = false;
      stateObj.submissionsValidateDisabled = true;
    }

    // checking these options disallows checking `submissionsViewPartial`
    if (
      stateObj.submissionsEdit ||
      stateObj.submissionsValidate
    ) {
      stateObj.submissionsViewPartial = false;
      stateObj.submissionsViewPartialDisabled = true;
      stateObj.submissionsViewPartialUsers = [];
    }

    return stateObj;
  }

  /**
   * We need it just to update the input,
   * the real work is handled by onUsernameChangeEnd.
   */
  onUsernameChange(username) {
    this.setState({
      username: username,
      isEditingUsername: true
    });
  }

  /**
   * Checks if username exist on the Backend and clears input if doesn't.
   */
  onUsernameChangeEnd() {
    this.setState({isEditingUsername: false});

    if (this.state.username === '') {
      return;
    }

    const userCheck = this.checkUsernameSync(this.state.username);
    if (userCheck === undefined) {
      this.checkUsernameAsync(this.state.username);
    } else if (userCheck === false) {
      this.notifyUnknownUser(this.state.username);
      this.setState({username: ''});
    }
  }

  /**
   * Enables Enter key on username input.
   */
  onUsernameKeyPress(key, evt) {
    if (key === 'Enter') {
      evt.currentTarget.blur();
      evt.preventDefault(); // prevent submitting form
    }
  }

  /**
   * Handles TagsInput change event and blocks adding nonexistent usernames.
   * Also unblocks the submit button.
   */
  onSubmissionsViewPartialUsersChange(allUsers) {
    this.setState({isAddingPartialUsernames: false});
    const submissionsViewPartialUsers = [];

    allUsers.forEach((username) => {
      const userCheck = this.checkUsernameSync(username);
      if (userCheck === true) {
        submissionsViewPartialUsers.push(username);
      } else if (userCheck === undefined) {
        // we add unknown usernames for now and will check and possibly remove
        // with checkUsernameAsync
        submissionsViewPartialUsers.push(username);
        this.checkUsernameAsync(username);
      } else {
        this.notifyUnknownUser(username);
      }
    });

    this.setState({submissionsViewPartialUsers: submissionsViewPartialUsers});
  }

  onSubmissionsViewPartialUsersInputFocus() {
    this.setState({isAddingPartialUsernames: true});
  }

  onSubmissionsViewPartialUsersInputBlur() {
    this.setState({isAddingPartialUsernames: false});
  }

  /**
   * This function returns either boolean (for known username) or undefined
   * for usernames that weren't checked before
   */
  checkUsernameSync(username) {
    return stores.userExists.checkUsername(username);
  }

  /**
   * This function calls API and relies on onUserExistsStoreChange callback
   */
  checkUsernameAsync(username) {
    const usernamesBeingChecked = this.state.usernamesBeingChecked;
    usernamesBeingChecked.add(username);
    this.setState({usernamesBeingChecked: usernamesBeingChecked});
    actions.misc.checkUsername(username);
  }

  notifyUnknownUser(username) {
    notify(`${t('User not found:')} ${username}`, 'warning');
  }

  /**
   * Remove nonexistent usernames from TagsInput list and from username input.
   */
  onUserExistsStoreChange(result) {
    // check partial view users
    const submissionsViewPartialUsers = this.state.submissionsViewPartialUsers;
    submissionsViewPartialUsers.forEach((username) => {
      if (result[username] === false) {
        submissionsViewPartialUsers.pop(submissionsViewPartialUsers.indexOf(username));
        this.notifyUnknownUser(username);
      }
    });
    this.setState({submissionsViewPartialUsers: submissionsViewPartialUsers});

    // check username
    if (result[this.state.username] === false) {
      this.notifyUnknownUser(this.state.username);
      this.setState({username: ''});
    }

    // clean usernamesBeingChecked array
    Object.keys(result).forEach((username) => {
      const usernamesBeingChecked = this.state.usernamesBeingChecked;
      usernamesBeingChecked.delete(username);
      this.setState({usernamesBeingChecked: usernamesBeingChecked});
    });
  }

  getLabel(permCodename) {
    return this.props.assignablePerms.get(permConfig.getPermissionByCodename(PERMISSIONS_CODENAMES.get(permCodename)).url);
  }

  isAssignable(permCodename) {
    return this.props.assignablePerms.has(permConfig.getPermissionByCodename(PERMISSIONS_CODENAMES.get(permCodename)).url);
  }

  /**
   * Blocks submitting non-ready form.
   */
  isSubmitEnabled() {
    const isAnyCheckboxChecked = (
      this.state.formView ||
      this.state.formEdit ||
      this.state.submissionsView ||
      this.state.submissionsViewPartial ||
      this.state.submissionsAdd ||
      this.state.submissionsEdit ||
      this.state.submissionsValidate
    );
    const isPartialValid = this.state.submissionsViewPartial ? this.state.submissionsViewPartialUsers.length !== 0 : true;
    return (
      isAnyCheckboxChecked &&
      isPartialValid &&
      !this.state.isSubmitPending &&
      !this.state.isEditingUsername &&
      !this.state.isAddingPartialUsernames &&
      this.state.username.length > 0 &&
      this.state.usernamesBeingChecked.size === 0 &&
      // we don't allow manual setting anonymous user permissions through UI
      this.state.username !== ANON_USERNAME
    );
  }

  /**
   * Returns only the properties for assignable permissions
   */
  getFormData() {
    const output = {
      username: this.state.username,
    };
    if (this.isAssignable('view_asset')) {output.formView = this.state.formView;}
    if (this.isAssignable('change_asset')) {output.formEdit = this.state.formEdit;}
    if (this.isAssignable('add_submissions')) {output.submissionsAdd = this.state.submissionsAdd;}
    if (this.isAssignable('view_submissions')) {output.submissionsView = this.state.submissionsView;}
    if (this.isAssignable('partial_submissions')) {
      output.submissionsViewPartial = this.state.submissionsViewPartial;
      output.submissionsViewPartialUsers = this.state.submissionsViewPartialUsers;
    }
    if (this.isAssignable('change_submissions')) {output.submissionsEdit = this.state.submissionsEdit;}
    if (this.isAssignable('validate_submissions')) {output.submissionsValidate = this.state.submissionsValidate;}
    return output;
  }

  submit(evt) {
    evt.preventDefault();

    if (!this.isSubmitEnabled()) {
      return;
    }

    const formData = this.getFormData();
    const parsedUser = permParser.parseFormData(formData);

    if (parsedUser.length > 0) {
      // bulk endpoint needs all other users permissions to be passed
      let otherUserPerms = this.props.nonOwnerPerms.filter((perm) => {
        return perm.user !== buildUserUrl(formData.username);
      });
      this.setState({isSubmitPending: true});
      actions.permissions.bulkSetAssetPermissions(
        this.props.uid,
        otherUserPerms.concat(parsedUser)
      );
    } else {
      // if nothing changes but user submits, just notify parent we're good
      this.notifyParentAboutSubmitEnd(true);
    }

    return false;
  }

  render() {
    const isNew = typeof this.props.username === 'undefined';

    const submissionsViewPartialUsersInputProps = {
      placeholder: t('Enter usernames separated by spaces'),
      onFocus: this.onSubmissionsViewPartialUsersInputFocus,
      onBlur: this.onSubmissionsViewPartialUsersInputBlur
    };

    let submissionsViewPartialUsersClassName = 'react-tagsinput';
    if (
      this.state.submissionsViewPartial &&
      this.state.submissionsViewPartialUsers.length === 0 &&
      !this.state.isAddingPartialUsernames
    ) {
      submissionsViewPartialUsersClassName += ' react-tagsinput-invalid';
    }

    const formModifiers = [];
    if (this.state.isSubmitPending) {
      formModifiers.push('pending');
    }

    return (
      <bem.FormModal__form
        m={formModifiers}
        className='user-permissions-editor'
        onSubmit={this.submit}
      >
        {isNew &&
          // don't display username editor when editing existing user
          <div className='user-permissions-editor__row user-permissions-editor__row--username'>
            <TextBox
              placeholder={t('username')}
              value={this.state.username}
              onChange={this.onUsernameChange}
              onBlur={this.onUsernameChangeEnd}
              onKeyPress={this.onUsernameKeyPress}
              errors={this.state.username.length === 0}
            />
          </div>
        }

        <div className='user-permissions-editor__row'>
          {this.isAssignable('view_asset') &&
            <Checkbox
              checked={this.state.formView}
              disabled={this.state.formViewDisabled}
              onChange={this.onCheckboxChange.bind(this, 'formView')}
              label={this.getLabel('view_asset')}
            />
          }

          {this.isAssignable('change_asset') &&
            <Checkbox
              checked={this.state.formEdit}
              onChange={this.onCheckboxChange.bind(this, 'formEdit')}
              label={this.getLabel('change_asset')}
            />
          }

          {this.isAssignable('view_submissions') &&
            <Checkbox
              checked={this.state.submissionsView}
              disabled={this.state.submissionsViewDisabled}
              onChange={this.onCheckboxChange.bind(this, 'submissionsView')}
              label={this.getLabel('view_submissions')}
            />
          }

          {this.isAssignable('partial_submissions') && this.state.submissionsView === true &&
            <div className='user-permissions-editor__sub-row'>
              <Checkbox
                checked={this.state.submissionsViewPartial}
                disabled={this.state.submissionsViewPartialDisabled}
                onChange={this.onCheckboxChange.bind(this, 'submissionsViewPartial')}
                label={this.getLabel('partial_submissions')}
              />

              {this.state.submissionsViewPartial === true &&
                <TagsInput
                  className={submissionsViewPartialUsersClassName}
                  value={this.state.submissionsViewPartialUsers}
                  onChange={this.onSubmissionsViewPartialUsersChange}
                  addOnBlur
                  addKeys={[KEY_CODES.get('ENTER'), KEY_CODES.get('SPACE'), KEY_CODES.get('TAB')]}
                  inputProps={submissionsViewPartialUsersInputProps}
                  onlyUnique
                />
              }
            </div>
          }

          {this.isAssignable('add_submissions') &&
            <Checkbox
              checked={this.state.submissionsAdd}
              onChange={this.onCheckboxChange.bind(this, 'submissionsAdd')}
              label={this.getLabel('add_submissions')}
            />
          }

          {this.isAssignable('change_submissions') &&
            <Checkbox
              checked={this.state.submissionsEdit}
              disabled={this.state.submissionsEditDisabled}
              onChange={this.onCheckboxChange.bind(this, 'submissionsEdit')}
              label={this.getLabel('change_submissions')}
            />
          }

          {this.isAssignable('validate_submissions') &&
            <Checkbox
              checked={this.state.submissionsValidate}
              disabled={this.state.submissionsValidateDisabled}
              onChange={this.onCheckboxChange.bind(this, 'submissionsValidate')}
              label={this.getLabel('validate_submissions')}
            />
          }
        </div>

        <div className='user-permissions-editor__row'>
          <bem.Button
            m={['raised', 'colored']}
            type='submit'
            disabled={!this.isSubmitEnabled()}
            >
              {isNew ? t('Grant permissions') : t('Update permissions')}
            </bem.Button>
        </div>
      </bem.FormModal__form>
    );
  }
}
reactMixin(UserAssetPermsEditor.prototype, Reflux.ListenerMixin);

export default UserAssetPermsEditor;
