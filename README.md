# 介绍

本项目是公众号：老东谈道理 正在使用的公众号编辑器
为了解决写文章耗时太久的痛点制作的
本项目最初只是一堆命令行工具，后面公众号做起来后就需要更完善的流程
然后根据这个流程，完善了这个项目的web页面
能索引我之前的内容，这样就不会出现风格变化太大和身份有时候不对了

# 使用过程

1. 配置 ai key，这个是生成文章的关键，项目内部有一套简单的提示词工程，复制提供公众号指导，公众号素材，往期素材，写作指南等提示词
2. 输入标题，生成草稿文章，填写公众号主题和素材，ai 生成
3. 可以进入公众号样式页面，实时预览生成的效果，和自己自定义相关的样式
4. 支持配置生图模型生成公众号图片
5. 秉持简单原则，上传到公众号这一步需要你自己完成，因为自动发布需要企业资质，目前无法完成

# 后续

~~1. 集成素材收集模块，从小红书，百度，官网等地方收集素材~~  
~~2. rag 提供往期文章片段，形成知识库，保障文章风格一致~~  
~~3. 完善和集成 ai 功能，让 ai 赋能到更多写作场景和效率提升~~  
~~ 4. 支持绑定公众号，获取公众号数据预览 ~~  
~~优先级 模块 工作量P0 后端绑定 + token 管理（wechat.js 路由） 约 2hP0 AISettings 「公众号」Panel（输入 + 账号信息展示） 约 1hP1 草稿箱列表拉取 + 展示 约 1hP1 「上传草稿」按钮（含图片 media_id 转换） 约 3h（最复杂）P2 近 7 天数据统计展示 约 1h~~   

# 目前的页面

<img width="1501" height="803" alt="image" src="https://github.com/user-attachments/assets/61accced-c751-461a-8d42-7f7f2a3bf528" />
ai 配置  
<img width="1511" height="884" alt="2b5fce749cc9e327775d7796f74ddb78" src="https://github.com/user-attachments/assets/f5899928-8713-4158-9f34-fa91c382968c" />
公众号预览  
<img width="1512" height="800" alt="264b18843271a8f9faef4e0daf5fa05f" src="https://github.com/user-attachments/assets/4041dc26-fd9c-4868-b496-353945e80076" />
样式管理  
<img width="1488" height="786" alt="150278045f7e43d6ac330ccabf7cb095" src="https://github.com/user-attachments/assets/3bb9586e-f3d6-4b33-8192-5b883d841b42" />
