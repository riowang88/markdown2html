import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import classnames from "classnames";
import {Tag} from "antd";

import Bold from "../component/Toolbar/Bold";
import Code from "../component/Toolbar/Code";
import Del from "../component/Toolbar/Del";
import Italic from "../component/Toolbar/Italic";
import Link from "../component/Toolbar/Link";
import Table from "../component/Toolbar/Table";
import Image from "../component/Toolbar/Image";
import Format from "../component/Toolbar/Format";
import LinkToFoot from "../component/Toolbar/LinkToFoot";
import InlineCode from "../component/Toolbar/InlineCode";
import Theme from "../component/MenuLeft/Theme";
import CodeTheme from "../component/MenuLeft/CodeTheme";
import "./Navbar.css";

@inject("view")
@inject("yibanTemplate")
@observer
class Toolbar extends Component {
  handleExitTemplate = () => {
    this.props.yibanTemplate.clearActiveTemplate();
  };

  render() {
    const {token} = this.props;
    const {isTemplateMode, activeTemplate} = this.props.yibanTemplate;
    const niceNavbarClass = classnames({
      "nice-navbar": true,
      "nice-toolbar": true,
    });
    return (
      <div className={niceNavbarClass}>
        <div className="nice-left-nav">
          <Del />
          <Bold />
          <Italic />
          <Code />
          <InlineCode />
          <Link />
          <Table />
          <Image />
          <LinkToFoot />
          <Format />
        </div>
        <div className="nice-right-nav">
          {isTemplateMode && activeTemplate ? (
            <Tag closable onClose={this.handleExitTemplate} color="green" style={{marginRight: 8, lineHeight: "28px"}}>
              {"模板: "}
              {activeTemplate.display_name}
            </Tag>
          ) : (
            <Theme token={token} />
          )}
          <CodeTheme />
        </div>
      </div>
    );
  }
}

export default Toolbar;
