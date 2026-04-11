import {observable, action, autorun} from "mobx";
import {debounce} from "lodash";
import {YIBAN_TEMPLATE_MODE, YIBAN_ACTIVE_TEMPLATE, YIBAN_RECENT_TEMPLATES, MARKDOWN_THEME_ID} from "../utils/constant";
import {replaceStyle} from "../utils/helper";

class YibanTemplate {
  @observable isTemplateMode = false;

  @observable activeTemplate = null;

  @observable templateList = [];

  @observable totalCount = 0;

  @observable currentPage = 1;

  @observable isLoading = false;

  @observable renderedHtml = "";

  @observable recentTemplates = [];

  constructor() {
    const mode = window.localStorage.getItem(YIBAN_TEMPLATE_MODE);
    this.isTemplateMode = mode === "true";

    const recent = window.localStorage.getItem(YIBAN_RECENT_TEMPLATES);
    if (recent) {
      try {
        this.recentTemplates = JSON.parse(recent);
      } catch (e) {
        this.recentTemplates = [];
      }
    }
  }

  @action
  setTemplateMode = (isTemplateMode) => {
    this.isTemplateMode = isTemplateMode;
    window.localStorage.setItem(YIBAN_TEMPLATE_MODE, String(isTemplateMode));
    if (!isTemplateMode) {
      this.activeTemplate = null;
      this.renderedHtml = "";
      window.localStorage.removeItem(YIBAN_ACTIVE_TEMPLATE);
    }
  };

  @action
  setActiveTemplate = (template) => {
    this.activeTemplate = template;
    if (template) {
      window.localStorage.setItem(YIBAN_ACTIVE_TEMPLATE, String(template.id));
      this.addToRecent(template);
    }
  };

  @action
  clearActiveTemplate = () => {
    this.setTemplateMode(false);
  };

  @action
  setTemplateList = (list, totalCount) => {
    this.templateList = list;
    this.totalCount = totalCount;
  };

  @action
  setCurrentPage = (page) => {
    this.currentPage = page;
  };

  @action
  setLoading = (isLoading) => {
    this.isLoading = isLoading;
  };

  @action
  setRenderedHtml = (html) => {
    this.renderedHtml = html;
  };

  @action
  addToRecent = (template) => {
    const item = {
      id: template.id,
      display_name: template.display_name,
      cover_image_yiban: template.cover_image_yiban,
    };
    const filtered = this.recentTemplates.filter((t) => t.id !== template.id);
    this.recentTemplates = [item, ...filtered].slice(0, 10);
    window.localStorage.setItem(YIBAN_RECENT_TEMPLATES, JSON.stringify(this.recentTemplates));
  };
}

const store = new YibanTemplate();

// Lazy-load the render engine to avoid circular deps
let renderFn = null;
const getRenderFn = () => {
  if (!renderFn) {
    const {renderTemplatePreview} = require("../utils/yibanTemplate");
    renderFn = renderTemplatePreview;
  }
  return renderFn;
};

let contentStore = null;
const getContentStore = () => {
  if (!contentStore) {
    contentStore = require("./content").default;
  }
  return contentStore;
};

const debouncedRender = debounce(() => {
  if (store.isTemplateMode && store.activeTemplate) {
    try {
      const html = getRenderFn()(getContentStore().content, store.activeTemplate);
      store.setRenderedHtml(html);
    } catch (e) {
      console.error("Template render error:", e);
    }
  }
}, 300);

autorun(() => {
  const mode = store.isTemplateMode;
  const template = store.activeTemplate;
  // eslint-disable-next-line no-unused-expressions
  getContentStore().content; // track dependency

  if (mode && template) {
    replaceStyle(MARKDOWN_THEME_ID, "");
    debouncedRender();
  }
});

export default store;
