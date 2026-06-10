import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {Tooltip} from "antd";

import {ENTER_DELAY, LEAVE_DELAY} from "../../utils/constant";
import SvgIcon from "../../icon";
import "./TemplateGallery.css";

@inject("dialog")
@observer
class TemplateGallery extends Component {
  handleClick = () => {
    this.props.dialog.setTemplateGalleryOpen(true);
  };

  render() {
    return (
      <Tooltip placement="left" mouseEnterDelay={ENTER_DELAY} mouseLeaveDelay={LEAVE_DELAY} title="文章模板">
        <a id="nice-sidebar-template" className="nice-btn-template" onClick={this.handleClick}>
          <SvgIcon name="template" className="nice-btn-template-icon" />
        </a>
      </Tooltip>
    );
  }
}

export default TemplateGallery;
