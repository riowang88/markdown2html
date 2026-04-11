import React, {Component} from "react";
import {observer, inject} from "mobx-react";

@inject("dialog")
@observer
class TemplateGallery extends Component {
  handleClick = () => {
    this.props.dialog.setTemplateGalleryOpen(true);
  };

  render() {
    return (
      <a onClick={this.handleClick} href="#">
        文章模板
      </a>
    );
  }
}

export default TemplateGallery;
