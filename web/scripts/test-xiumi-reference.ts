import assert from 'node:assert/strict'
import { validateXiumiUrl, extractXiumiStyles } from '../server/utils/xiumiReference.ts'
assert.equal(validateXiumiUrl('https://v.xiumi.us/board/v5/demo/123?tracking=1').search, '')
assert.equal(validateXiumiUrl('https://sd.xiumius.cn/xmi/pd/demo/123.json', true).hostname, 'sd.xiumius.cn')
for (const value of ['https://localhost/', 'https://v.xiumi.us.evil.test/board/v5/demo/123', 'http://v.xiumi.us/board/v5/demo/123', 'https://user:pass@v.xiumi.us/board/v5/demo/123', 'https://v.xiumi.us:8080/board/v5/demo/123', 'https://v.xiumi.us/studio/v5', 'https://sd.xiumius.cn/private.json']) assert.throws(() => validateXiumiUrl(value))
const styles = extractXiumiStyles({text:'不要发送原文', _comp:{style:{color:'#aabbcc',fontSize:'20px',backgroundColor:'url(https://evil.test)',onclick:'alert(1)'}}, children:[{style:{color:'#aabbcc',fontSize:'20px'}}]})
assert.deepEqual(styles,[{color:'#aabbcc',fontSize:'20px'}])
assert.ok(!JSON.stringify(styles).includes('不要发送原文'))
console.log('Xiumi URL boundary and style-only extraction passed')

assert.deepEqual(extractXiumiStyles({_comp:{_$raHTML:'<section style="font-size: 22px; color: #336655; background-color: url(https://evil.test)">原文不得进入样式</section>'}}), [{fontSize:'22px',color:'#336655'}])
