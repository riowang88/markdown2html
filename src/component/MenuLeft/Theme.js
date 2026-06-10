import React from "react";
import {Menu, Dropdown} from "antd";
import {observer, inject} from "mobx-react";

import {RIGHT_SYMBOL, TEMPLATE_NUM, MARKDOWN_THEME_ID, STYLE} from "../../utils/constant";
import {replaceStyle} from "../../utils/helper";
import TEMPLATE from "../../template/index";
import "./Theme.css";

@inject("content")
@inject("navbar")
@inject("view")
@observer
class Theme extends React.Component {
  changeTemplate = (item) => {
    const index = parseInt(item.key, 10);
    const {themeId, css} = this.props.content.themeList[index];
    this.props.navbar.setTemplateNum(index);

    // 更新style编辑器
    if (themeId === "custom") {
      this.props.content.setCustomStyle();
      // 切换自定义自动打开css编辑
      this.props.view.setStyleEditorOpen(true);
    } else {
      this.props.content.setStyle(css);
    }
  };

  toggleStyleEditor = () => {
    const {isStyleEditorOpen} = this.props.view;
    this.props.view.setStyleEditorOpen(!isStyleEditorOpen);
  };

  subscribeMore = () => {
    const w = window.open("about:blank");
    w.location.href = "https://preview.mdnice.com/themes";
  };

  componentDidMount = async () => {
    const themeList = [
      {themeId: "1", name: "赤陶暖阳", css: TEMPLATE.theme.one},
      {themeId: "2", name: "樱花物语", css: TEMPLATE.theme.two},
      {themeId: "3", name: "落日杂志", css: TEMPLATE.theme.three},
      {themeId: "4", name: "薄荷科技", css: TEMPLATE.theme.four},
      {themeId: "16", name: "瑞士极简", css: TEMPLATE.theme.sixteen},
      {themeId: "17", name: "新粗野主义", css: TEMPLATE.theme.seventeen},
      {themeId: "18", name: "暗夜优雅", css: TEMPLATE.theme.eighteen},
      {themeId: "19", name: "柔和低语", css: TEMPLATE.theme.nineteen},
      {themeId: "20", name: "极光渐变", css: TEMPLATE.theme.twenty},
      {themeId: "21", name: "墨纸古韵", css: TEMPLATE.theme.twentyone},
      {themeId: "22", name: "金融简报", css: TEMPLATE.theme.twentytwo, isNew: true},
      {themeId: "23", name: "竹林清风", css: TEMPLATE.theme.twentythree, isNew: true},
      {themeId: "24", name: "赛博朋克", css: TEMPLATE.theme.twentyfour, isNew: true},
      {themeId: "25", name: "咖啡手记", css: TEMPLATE.theme.twentyfive, isNew: true},
      {themeId: "26", name: "极简线条", css: TEMPLATE.theme.twentysix, isNew: true},
      {themeId: "27", name: "故事集", css: TEMPLATE.theme.twentyseven, isNew: true},
      {themeId: "custom", name: "自定义", css: TEMPLATE.theme.custom},
    ];

    this.props.content.setThemeList(themeList);
    // 设置一下自定义的规则
    if (!window.localStorage.getItem(STYLE)) {
      window.localStorage.setItem(STYLE, TEMPLATE.theme.custom);
    }
    let templateNum = parseInt(window.localStorage.getItem(TEMPLATE_NUM), 10);

    // 越界修正：旧索引超出新列表范围时归零
    if (Number.isNaN(templateNum) || templateNum < 0 || templateNum >= themeList.length) {
      templateNum = 0;
      this.props.navbar.setTemplateNum(0);
    }

    // 主题样式初始化，属于自定义主题则从localstorage中读数据
    let style = "";
    if (templateNum === themeList.length - 1) {
      style = window.localStorage.getItem(STYLE);
    } else {
      const {css} = themeList[templateNum];
      style = css;
    }
    this.props.content.setStyle(style);
    replaceStyle(MARKDOWN_THEME_ID, style);
  };

  render() {
    const {templateNum} = this.props.navbar;
    const {themeList} = this.props.content;

    const mdMenu = (
      <Menu onClick={this.changeTemplate}>
        {themeList.map((option, index) => (
          <Menu.Item key={index}>
            <div id={`nice-menu-theme-${option.themeId}`} className="nice-themeselect-theme-item">
              <span>
                <span className="nice-themeselect-theme-item-flag">
                  {templateNum === index && <span>{RIGHT_SYMBOL}</span>}
                </span>
                <span className="nice-themeselect-theme-item-name">{option.name}</span>
                {option.isNew && <span className="nice-themeselect-theme-item-new">new</span>}
              </span>
            </div>
          </Menu.Item>
        ))}
        <Menu.Divider />
        <li className="nice-themeselect-menu-item">
          <div id="nice-menu-view-css" className="nice-themeselect-theme-item" onClick={this.toggleStyleEditor}>
            <span>
              <span className="nice-themeselect-theme-item-flag">
                {this.props.view.isStyleEditorOpen && <span>{RIGHT_SYMBOL}</span>}
              </span>
              <span className="nice-themeselect-theme-item-name">查看主题 CSS</span>
            </span>
          </div>
        </li>
      </Menu>
    );
    return (
      <Dropdown overlay={mdMenu} trigger={["click"]} overlayClassName="nice-overlay">
        <a id="nice-menu-theme" className="nice-menu-link" href="#">
          主题
        </a>
      </Dropdown>
    );
  }
}

export default Theme;
