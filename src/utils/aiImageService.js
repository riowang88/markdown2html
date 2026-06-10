import axios from "axios";

const BASE_URL = process.env.NODE_ENV === "production" ? "https://apihub.agnes-ai.com" : "/api/agnes";

const axiosAgnes = axios.create({
  baseURL: BASE_URL,
  headers: {"Content-Type": "application/json"},
});

export const generateImage = async (apiKey, prompt, size = "1024x1024") => {
  const response = await axiosAgnes.post(
    "/v1/images/generations",
    {
      model: "agnes-image-2.1-flash",
      prompt,
      size,
      n: 1,
    },
    {
      headers: {Authorization: `Bearer ${apiKey}`},
    },
  );
  return response.data;
};

export const analyzeArticleForImages = (markdownContent) => {
  const lines = markdownContent.split("\n");
  const sections = [];
  let currentSection = {startLine: 0, lines: []};

  lines.forEach((line, index) => {
    if (line.startsWith("## ")) {
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {startLine: index, lines: []};
    } else {
      currentSection.lines.push({text: line, lineNum: index});
    }
  });
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  const results = [];
  sections.forEach((section) => {
    const text = section.lines.map((l) => l.text).join("\n");
    if (text.length > 150 && !text.includes("![")) {
      const context = text.slice(0, 200);
      const suggestedPrompt = text
        .replace(/[#*`>\-\n]/g, " ")
        .trim()
        .slice(0, 80);
      results.push({
        line: section.startLine + 1,
        context,
        suggestedPrompt,
      });
    }
  });

  return results;
};
