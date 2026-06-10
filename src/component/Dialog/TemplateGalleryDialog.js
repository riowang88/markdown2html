import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {reaction} from "mobx";
import {Modal, Pagination, Spin, message, Button} from "antd";
import {fetchTemplateList, fetchTemplateDetail} from "../../utils/yibanTemplate";
import "./TemplateGalleryDialog.css";

@inject("dialog")
@inject("yibanTemplate")
@observer
class TemplateGalleryDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      previewTemplate: null,
      previewLoading: false,
      templateCache: {},
    };
  }

  componentDidMount() {
    this.disposeReaction = reaction(
      () => this.props.dialog.isTemplateGalleryOpen,
      (isOpen) => {
        if (isOpen && this.props.yibanTemplate.templateList.length === 0) {
          this.loadTemplates(1);
        }
      },
    );
  }

  componentWillUnmount() {
    if (this.disposeReaction) this.disposeReaction();
  }

  loadTemplates = async (page) => {
    const {yibanTemplate} = this.props;
    yibanTemplate.setLoading(true);
    try {
      const {list, totalCount} = await fetchTemplateList(page, 20);
      yibanTemplate.setTemplateList(list, totalCount);
      yibanTemplate.setCurrentPage(page);
    } catch (e) {
      message.error("加载模板列表失败，请检查网络");
      console.error(e);
    }
    yibanTemplate.setLoading(false);
  };

  handlePreview = async (templateId) => {
    if (this.state.templateCache[templateId]) {
      this.setState((prev) => ({previewTemplate: prev.templateCache[templateId]}));
      return;
    }
    this.setState({previewLoading: true});
    try {
      const detail = await fetchTemplateDetail(templateId);
      this.setState((prev) => ({
        previewTemplate: detail,
        previewLoading: false,
        templateCache: {...prev.templateCache, [templateId]: detail},
      }));
    } catch (e) {
      message.error("加载模板详情失败");
      this.setState({previewLoading: false});
    }
  };

  handleUse = async (templateId) => {
    let detail = this.state.templateCache[templateId];
    if (!detail) {
      try {
        detail = await fetchTemplateDetail(templateId);
        this.setState((prev) => ({
          templateCache: {...prev.templateCache, [templateId]: detail},
        }));
      } catch (e) {
        message.error("加载模板详情失败");
        return;
      }
    }
    const {yibanTemplate, dialog} = this.props;
    yibanTemplate.setActiveTemplate(detail);
    yibanTemplate.setTemplateMode(true);
    dialog.setTemplateGalleryOpen(false);
    this.setState({previewTemplate: null});
    message.success(`已应用模板: ${detail.display_name}`);
  };

  handleClose = () => {
    this.props.dialog.setTemplateGalleryOpen(false);
    this.setState({previewTemplate: null});
  };

  handleBackToGallery = () => {
    this.setState({previewTemplate: null});
  };

  renderRecentSection() {
    const {recentTemplates} = this.props.yibanTemplate;
    if (!recentTemplates || recentTemplates.length === 0) return null;

    return (
      <div className="tpl-recent-section">
        <div className="tpl-recent-title">最近使用</div>
        <div className="tpl-recent-list">
          {recentTemplates.map((t) => (
            <div key={t.id} className="tpl-recent-item" onClick={() => this.handleUse(t.id)}>
              <img src={t.cover_image_yiban} alt={t.display_name} referrerPolicy="no-referrer" />
              <span>{t.display_name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  renderGallery() {
    const {templateList, totalCount, currentPage, isLoading} = this.props.yibanTemplate;

    return (
      <Spin spinning={isLoading}>
        {this.renderRecentSection()}
        <div className="tpl-gallery-grid">
          {templateList.map((t) => (
            <div key={t.id} className="tpl-card">
              <div className="tpl-card-cover">
                <img src={t.cover_image_yiban} alt={t.display_name} referrerPolicy="no-referrer" loading="lazy" />
                <div className="tpl-card-overlay">
                  <Button size="small" onClick={() => this.handlePreview(t.id)}>
                    预览
                  </Button>
                  <Button size="small" type="primary" onClick={() => this.handleUse(t.id)}>
                    使用
                  </Button>
                </div>
              </div>
              <div className="tpl-card-info">
                <span className="tpl-card-name">{t.display_name}</span>
                <span className="tpl-card-stats">
                  {t.use_count > 0 && `${t.use_count}次使用`}
                  {t.fav_count > 0 && ` · ${t.fav_count}收藏`}
                </span>
              </div>
            </div>
          ))}
        </div>
        {totalCount > 20 && (
          <div className="tpl-pagination">
            <Pagination
              current={currentPage}
              total={totalCount}
              pageSize={20}
              onChange={(page) => this.loadTemplates(page)}
              showSizeChanger={false}
            />
          </div>
        )}
      </Spin>
    );
  }

  renderPreview() {
    const {previewTemplate, previewLoading} = this.state;

    if (previewLoading) {
      return (
        <div className="tpl-preview-loading">
          <Spin size="large" />
        </div>
      );
    }

    if (!previewTemplate) return null;

    return (
      <div className="tpl-preview-container">
        <div className="tpl-preview-header">
          <Button onClick={this.handleBackToGallery}>返回列表</Button>
          <span className="tpl-preview-name">{previewTemplate.display_name}</span>
          <Button type="primary" onClick={() => this.handleUse(previewTemplate.id)}>
            使用此模板
          </Button>
        </div>
        <div className="tpl-preview-frame">
          <iframe
            title="template-preview"
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}</style></head><body>${previewTemplate.total}</body></html>`}
            className="tpl-preview-iframe"
          />
        </div>
      </div>
    );
  }

  render() {
    const {isTemplateGalleryOpen} = this.props.dialog;
    const {previewTemplate} = this.state;

    return (
      <Modal
        className="nice-template-gallery"
        title="文章模板"
        centered
        width="90vw"
        visible={isTemplateGalleryOpen}
        onCancel={this.handleClose}
        footer={null}
        bodyStyle={{maxHeight: "80vh", overflow: "auto", padding: previewTemplate ? "0" : "24px"}}
      >
        {previewTemplate ? this.renderPreview() : this.renderGallery()}
      </Modal>
    );
  }
}

export default TemplateGalleryDialog;
