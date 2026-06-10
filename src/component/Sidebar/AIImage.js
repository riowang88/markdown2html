import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {Tooltip} from "antd";

import {ENTER_DELAY, LEAVE_DELAY} from "../../utils/constant";
import AIImageIcon from "../../icon/AIImage";
import "./AIImage.css";

@inject("dialog")
@observer
class AIImage extends Component {
  openDialog = () => {
    this.props.dialog.setAIImageOpen(true);
  };

  render() {
    return (
      <Tooltip placement="left" mouseEnterDelay={ENTER_DELAY} mouseLeaveDelay={LEAVE_DELAY} title="AI 配图">
        <a id="nice-sidebar-ai-image" className="nice-btn-ai-image" onClick={this.openDialog}>
          <AIImageIcon className="nice-btn-ai-image-icon" />
        </a>
      </Tooltip>
    );
  }
}

export default AIImage;
