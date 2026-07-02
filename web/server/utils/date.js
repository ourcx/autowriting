

// 当前的时间
export const nowDay = () => {
    new Date().toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })

} 