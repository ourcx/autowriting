const DEFAULT_COVER_PROMPT_PREFIX =
  "生成一个公众号文章封面，2.35:1，需要简约，不需要实物，给我来点好看的，标题是："

const STYLE_PROMPTS: Record<string, string> = {
  modern: "现代简约，使用清晰的几何关系、克制的层次和干净留白",
  minimalist: "极简风格，大面积留白、少量强调色和纤细线条",
  gradient: "柔和渐变、轻微光感和细腻纹理，保持画面简洁",
  illustration: "抽象编辑插画，以几何图形、色块和线条表达主题，不画人物或具体物件",
  photography: "抽象光影与电影感配色，不使用照片、人物、场景或写实物体",
  abstract: "抽象几何构图，通过重叠形状、节奏和留白营造视觉张力",
}

const COLOR_NAMES: Record<string, string> = {
  matcha: "抹茶绿（#078a52）搭配白色",
  slushie: "青蓝色（#3bd3fd）搭配浅色背景",
  lemon: "金黄色（#fbbd41）搭配深色点缀",
  ube: "深紫色（#43089f）搭配明亮高光",
  pomegranate: "珊瑚红（#fc7981）搭配柔和阴影",
  blueberry: "海军蓝（#01418d）搭配浅色点缀",
}

export function generatePrompt(title: string, content: string, style: string, color: string): string {
  const styleDescription = STYLE_PROMPTS[style] || STYLE_PROMPTS.modern
  const colorDescription = COLOR_NAMES[color] || "使用协调、耐看的强调色"
  const contentPreview = (content || "").substring(0, 80).replace(/[#*[\]`]/g, "").trim()
  const topicHint = contentPreview ? `\n- 文章主题参考：${contentPreview}` : ""

  return `${DEFAULT_COVER_PROMPT_PREFIX}${title}。

画面要求：
- 风格：${styleDescription}
- 配色：${colorDescription}${topicHint}
- 只使用抽象几何图形、色块、线条、留白、光影和轻微纹理表达主题
- 不出现人物、动物、商品、设备、建筑、场景照片或其他写实物体
- 不在图片中绘制标题、文字、Logo、水印或边框
- 构图简洁、平衡、有设计感，适合微信公众号横版头图
- 保持清晰的视觉焦点与足够留白，不堆砌元素`
}

