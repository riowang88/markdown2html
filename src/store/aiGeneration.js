import {observable, action} from "mobx";
import {AGNES_API_KEY} from "../utils/constant";

class AIGeneration {
  @observable apiKey = "";

  @observable isGenerating = false;

  @observable generatedImages = [];

  @observable error = "";

  @action
  setApiKey = (key) => {
    this.apiKey = key;
    localStorage.setItem(AGNES_API_KEY, key);
  };

  @action
  setGenerating = (v) => {
    this.isGenerating = v;
  };

  @action
  addGeneratedImage = (img) => {
    this.generatedImages.push(img);
  };

  @action
  clearGeneratedImages = () => {
    this.generatedImages = [];
  };

  @action
  setError = (err) => {
    this.error = err;
  };
}

const store = new AIGeneration();
store.apiKey = localStorage.getItem(AGNES_API_KEY) || "";

export default store;
