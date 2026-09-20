import { useEffect, useMemo, useState } from "react"
import {
  ACTIONS,
  EVENTS,
  Joyride,
  STATUS,
  type EventData,
  type Step,
} from "react-joyride"
import {
  completeGuide,
  type GuidePage,
} from "../../utils/userExperience"
import "./OnboardingGuide.css"

interface OnboardingGuideProps {
  page: GuidePage
  userId: string
  run: boolean
  onClose: () => void
}

const PAGE_STEPS: Record<GuidePage, Step[]> = {
  dashboard: [
    {
      target: '[data-onboarding="setup-status"]',
      title: "先看配置状态",
      content: "这里会显示 AI 和发布账号是否就绪。缺什么就从这里补，不需要一次配置所有平台。",
      placement: "bottom-end",
    },
    {
      target: '[data-onboarding="start-writing"]',
      title: "创建第一篇文章",
      content: "填标题后点击“开始写作”，接下来只需要沿着编辑器主流程往下走。",
      placement: "right",
    },
  ],
  editor: [
    {
      target: '[data-onboarding="editor-workflow"]',
      title: "四段主流程",
      content: "先准备主题和素材，再生成母稿、审核定稿，最后选择平台发布。",
      placement: "bottom",
    },
    {
      target: '[data-onboarding="editor-prepare"]',
      title: "任务与素材放在一起",
      content: "这两个入口属于同一准备阶段，可以随时来回补充。",
      placement: "bottom",
    },
    {
      target: '[data-onboarding="next-action"]',
      title: "从这里继续",
      content: "每个阶段只有一个主要下一步操作。移动端会固定在屏幕底部。",
      placement: "top-end",
    },
  ],
  publish: [
    {
      target: '[data-onboarding="publish-platforms"]',
      title: "选择发布平台",
      content: "在这里切换公众号、今日头条或小红书，并查看各平台正文是否就绪。",
      placement: "bottom",
    },
    {
      target: '[data-onboarding="publish-account-status"]',
      title: "确认账号连接",
      content: "发布前先看当前平台的连接状态，未连接时可以直接前往“账号与发布”。",
      placement: "bottom-end",
    },
    {
      target: '[data-onboarding="publish-workbench"]',
      title: "检查后发布",
      content: "预览正文和素材，确认无误后使用发布区里的主按钮完成操作。",
      placement: "top",
    },
  ],
}

export default function OnboardingGuide({ page, userId, run, onClose }: OnboardingGuideProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const steps = useMemo(() => PAGE_STEPS[page], [page])

  useEffect(() => {
    if (run) setStepIndex(0)
  }, [page, run])

  function finish() {
    completeGuide(userId, page)
    onClose()
  }

  function handleEvent(data: EventData) {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      finish()
      return
    }
    if (data.type === EVENTS.STEP_AFTER || data.type === EVENTS.TARGET_NOT_FOUND) {
      setStepIndex(previous => previous + (data.action === ACTIONS.PREV ? -1 : 1))
    }
  }

  return (
    <Joyride
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      locale={{
        back: "上一步",
        close: "关闭",
        last: "知道了",
        next: "下一步",
        nextWithProgress: "下一步（{current}/{total}）",
        open: "打开引导",
        skip: "跳过",
      }}
      options={{
        buttons: ["back", "skip", "primary"],
        closeButtonAction: "skip",
        dismissKeyAction: "close",
        overlayClickAction: false,
        showProgress: true,
        skipBeacon: true,
        blockTargetInteraction: false,
        primaryColor: "#1a3a3a",
        backgroundColor: "#fffaf0",
        textColor: "#3a3a3a",
        overlayColor: "rgba(10, 10, 10, 0.58)",
        zIndex: 1400,
        spotlightPadding: 8,
        spotlightRadius: 8,
      }}
      styles={{
        tooltip: {
          borderRadius: 8,
          boxShadow: "0 18px 48px rgba(10, 10, 10, 0.18)",
          maxWidth: 360,
          padding: 18,
        },
        tooltipTitle: {
          color: "#0a0a0a",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: 0,
        },
        tooltipContent: {
          fontSize: 13,
          lineHeight: 1.65,
          padding: "8px 0 14px",
        },
        buttonPrimary: {
          borderRadius: 6,
          minHeight: 36,
          padding: "0 14px",
        },
        buttonBack: {
          color: "#6a6a6a",
          marginRight: 8,
        },
        buttonSkip: {
          color: "#6a6a6a",
        },
      }}
    />
  )
}
