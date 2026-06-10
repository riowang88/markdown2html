import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {reaction} from "mobx";
import {Modal, Tabs, Input, Button, message, List, Checkbox, Spin} from "antd";

import {generateImage, analyzeArticleForImages} from "../../utils/aiImageService";

const {TextArea} = Input;
const {TabPane} = Tabs;

@inject("dialog")
@inject("content")
@inject("aiGeneration")
@observer
class AIImageDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      prompt: "",
      batchPoints: [],
      batchSelected: [],
      activeTab: "single",
    };
  }

  componentDidMount() {
    this.disposer = reaction(
      () => this.props.dialog.isAIImageOpen,
      (isOpen) => {
        if (isOpen) {
          this.extractContextPrompt();
        }
      },
    );
  }

  componentWillUnmount() {
    if (this.disposer) {
      this.disposer();
    }
  }

  handleClose = () => {
    this.props.dialog.setAIImageOpen(false);
  };

  handlePromptChange = (e) => {
    this.setState({prompt: e.target.value});
  };

  handleGenerate = async () => {
    const {prompt} = this.state;
    const {aiGeneration} = this.props;

    if (!aiGeneration.apiKey) {
      message.warning("请先配置 Agnes AI API Key");
      return;
    }
    if (!prompt.trim()) {
      message.warning("请输入图片描述");
      return;
    }

    aiGeneration.setGenerating(true);
    aiGeneration.setError("");

    try {
      const result = await generateImage(aiGeneration.apiKey, prompt);
      const imageUrl = result.data[0].url;
      aiGeneration.addGeneratedImage({url: imageUrl, prompt});
      this.insertImageAtCursor(imageUrl);
      message.success("图片已生成并插入");
      this.handleClose();
    } catch (err) {
      const errMsg = (err.response && err.response.data && err.response.data.error) || err.message;
      aiGeneration.setError(errMsg);
      message.error("生成失败: " + errMsg);
    } finally {
      aiGeneration.setGenerating(false);
    }
  };

  handleAnalyze = () => {
    const {markdownEditor} = this.props.content;
    if (!markdownEditor) return;

    const markdownContent = markdownEditor.getValue();
    const points = analyzeArticleForImages(markdownContent);

    if (points.length === 0) {
      message.info("未找到适合配图的段落");
      return;
    }

    this.setState({
      batchPoints: points,
      batchSelected: points.map((_, i) => i),
    });
  };

  handleBatchToggle = (index) => {
    this.setState((prev) => {
      const selected = prev.batchSelected.includes(index)
        ? prev.batchSelected.filter((i) => i !== index)
        : [...prev.batchSelected, index];
      return {batchSelected: selected};
    });
  };

  handleBatchGenerate = async () => {
    const {batchPoints, batchSelected} = this.state;
    const {aiGeneration} = this.props;

    if (!aiGeneration.apiKey) {
      message.warning("请先配置 Agnes AI API Key");
      return;
    }
    const selectedPoints = batchSelected.map((i) => batchPoints[i]);
    if (selectedPoints.length === 0) {
      message.warning("请至少选择一个段落");
      return;
    }

    aiGeneration.setGenerating(true);

    try {
      // eslint-disable-next-line no-await-in-loop
      const images = [];
      for (let idx = 0; idx < selectedPoints.length; idx++) {
        // eslint-disable-next-line no-await-in-loop
        const result = await generateImage(aiGeneration.apiKey, selectedPoints[idx].suggestedPrompt);
        images.push({...selectedPoints[idx], imageUrl: result.data[0].url});
      }

      this.insertBatchImages(images);
      message.success(`已生成并插入 ${images.length} 张配图`);
      this.handleClose();
    } catch (err) {
      const errMsg = (err.response && err.response.data && err.response.data.error) || err.message;
      aiGeneration.setError(errMsg);
      message.error("批量生成失败: " + errMsg);
    } finally {
      aiGeneration.setGenerating(false);
    }
  };

  insertImageAtCursor = (imageUrl) => {
    const {markdownEditor} = this.props.content;
    if (!markdownEditor) return;

    const cursor = markdownEditor.getCursor();
    markdownEditor.replaceSelection(`\n![AI Generated](${imageUrl})\n`, cursor);
    this.props.content.setContent(markdownEditor.getValue());
  };

  insertBatchImages = (images) => {
    const {markdownEditor} = this.props.content;
    if (!markdownEditor) return;

    const sorted = [...images].sort((a, b) => b.line - a.line);
    sorted.forEach((img) => {
      markdownEditor.replaceRange(`\n![AI Generated](${img.imageUrl})\n`, {line: img.line, ch: 0});
    });
    this.props.content.setContent(markdownEditor.getValue());
  };

  extractContextPrompt = () => {
    const {markdownEditor} = this.props.content;
    if (!markdownEditor) return;

    const cursor = markdownEditor.getCursor();
    const lineContent = markdownEditor.getLine(cursor.line);
    const context = lineContent
      .replace(/[#*`>-]/g, "")
      .trim()
      .slice(0, 80);
    if (context) {
      this.setState({prompt: context});
    }
  };

  handleTabChange = (key) => {
    this.setState({activeTab: key});
    if (key === "batch") {
      this.handleAnalyze();
    }
  };

  render() {
    const {isAIImageOpen} = this.props.dialog;
    const {isGenerating} = this.props.aiGeneration;
    const {prompt, batchPoints, batchSelected, activeTab} = this.state;

    return (
      <Modal
        title="AI 配图"
        visible={isAIImageOpen}
        onCancel={this.handleClose}
        footer={null}
        width={560}
        destroyOnClose
      >
        <Spin spinning={isGenerating} tip="正在生成...">
          <Tabs activeKey={activeTab} onChange={this.handleTabChange}>
            <TabPane tab="单图生成" key="single">
              <TextArea
                rows={3}
                placeholder="描述你想要的图片内容，例如：一杯咖啡旁边放着一本打开的书，暖色调"
                value={prompt}
                onChange={this.handlePromptChange}
              />
              <div style={{marginTop: 16, textAlign: "right"}}>
                <Button type="primary" onClick={this.handleGenerate} disabled={isGenerating}>
                  生成并插入
                </Button>
              </div>
            </TabPane>
            <TabPane tab="一键配图" key="batch">
              {batchPoints.length === 0 ? (
                <div style={{textAlign: "center", padding: "24px 0", color: "#999"}}>
                  点击此 Tab 后自动分析文章，找出适合配图的段落
                </div>
              ) : (
                <div>
                  <div style={{marginBottom: 8, color: "#666"}}>
                    {`找到 ${batchPoints.length} 个适合配图的段落，勾选后批量生成：`}
                  </div>
                  <List
                    size="small"
                    dataSource={batchPoints}
                    renderItem={(point, index) => (
                      <List.Item>
                        <Checkbox
                          checked={batchSelected.includes(index)}
                          onChange={() => this.handleBatchToggle(index)}
                        >
                          <span style={{fontSize: 12, color: "#999"}}>{`第 ${point.line} 行`}</span>
                          <br />
                          <span style={{fontSize: 13}}>{point.suggestedPrompt}</span>
                        </Checkbox>
                      </List.Item>
                    )}
                  />
                  <div style={{marginTop: 16, textAlign: "right"}}>
                    <Button type="primary" onClick={this.handleBatchGenerate} disabled={isGenerating}>
                      {`批量生成（${batchSelected.length} 张）`}
                    </Button>
                  </div>
                </div>
              )}
            </TabPane>
          </Tabs>
        </Spin>
      </Modal>
    );
  }
}

export default AIImageDialog;
