import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {Modal, Timeline, Button} from "antd";
import axios from "axios";
import {NEWEST_VERSION} from "../../utils/constant";
import SvgIcon from "../../icon";

import "./VersionDialog.css";

@inject("dialog")
@observer
class VersionDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // eslint-disable-next-line react/no-unused-state
      versionNumber: 0,
      versionTimeline: [],
      recommend: null,
      specialInfo: "",
    };
  }

  handleOk = () => {
    this.props.dialog.setVersionOpen(false);
  };

  handleCancel = () => {
    this.props.dialog.setVersionOpen(false);
  };

  handleMore = () => {
    const w = window.open("about:blank");
    w.location.href = "https://github.com/qq148376839/markdown2html/blob/master/CHANGELOG.md";
  };

  handleDocs = () => {
    const w = window.open("about:blank");
    w.location.href = "https://github.com/qq148376839/markdown2html";
  };

  componentDidMount = async () => {
    try {
      const data = {
        versionId: 2,
        versionNumber: "1.3.0",
        versionTimeline: [
          "2025-04-10 新增 Obsidian 插件，支持 URL hash 导入一键发布",
          "2025-04-09 修复多域名访问支持，homepage 改为相对路径",
          "2025-04-08 新增 6 个 Markdown 主题（sixteen ~ twentyone）",
          "2020-09-09 优化排版",
          "2020-09-08 fork 自 markdown nice",
        ],
        recommend: null,
        specialInfo: "",
      };
      const newestVersion = localStorage.getItem(NEWEST_VERSION);
      if (data.versionNumber !== newestVersion) {
        this.props.dialog.setVersionOpen(true);
        localStorage.setItem(NEWEST_VERSION, data.versionNumber);
      }
      this.setState({...data});
    } catch (err) {
      console.error("读取最新版本信息错误");
    }
  };

  render() {
    return (
      <Modal
        title="版本更新"
        visible={this.props.dialog.isVersionOpen}
        onOk={this.handleOk}
        onCancel={this.handleCancel}
        footer={[
          <Button key="submit" type="primary" onClick={this.handleOk}>
            确认
          </Button>,
        ]}
        destroyOnClose
      >
        <Timeline>
          {this.state.versionTimeline.map((version, index) => {
            if (index === 0) {
              return (
                <Timeline.Item key={index} dot={<SvgIcon name="environment" style={style.svgIcon} />}>
                  <strong>{version}</strong>
                </Timeline.Item>
              );
            } else {
              return <Timeline.Item key={index}>{version}</Timeline.Item>;
            }
          })}
          <Timeline.Item>
            了解更多，请查看
            <a
              id="nice-version-dialog-doc"
              style={{fontWeight: "bold"}}
              alt=""
              href="https://github.com/qq148376839/markdown2html"
              rel="noopener noreferrer"
              target="_blank"
            >
              用户与开发者文档
            </a>
          </Timeline.Item>
          {this.state.recommend && (
            <Timeline.Item dot={<SvgIcon name="more" style={style.svgIcon} />}>
              <a
                id="nice-version-dialog-recommend"
                style={{fontWeight: "bold", borderBottom: "double"}}
                alt=""
                href={this.state.recommend.link}
                rel="noopener noreferrer"
                target="_blank"
              >
                {this.state.recommend.mainInfo}
              </a>
            </Timeline.Item>
          )}
        </Timeline>
        {this.state.specialInfo && (
          <div
            id="nice-version-dialog-special"
            dangerouslySetInnerHTML={{__html: this.state.specialInfo}}
            className="specialInfo"
          />
        )}
      </Modal>
    );
  }
}

const style = {
  svgIcon: {
    width: "16px",
    height: "16px",
  },
};

export default VersionDialog;
