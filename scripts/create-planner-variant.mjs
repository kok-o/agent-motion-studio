// Original MIT fixture for replacement of the existing fictional planner drawing.
import { launchBrowser, findTools } from '../dist/runtime.js';
import { writeFile } from 'node:fs/promises';
const browser=await launchBrowser(findTools().chrome);
try{
  const page=await browser.newPage();await page.setViewport({width:1400,height:900,deviceScaleFactor:1});
  await page.setContent('<canvas width="1400" height="900"></canvas>');
  const data=await page.evaluate(()=>{
    const ctx=document.querySelector('canvas').getContext('2d');
    const box=(x,y,w,h,c,r=20)=>{ctx.fillStyle=c;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
    const text=(s,x,y,size=32,color='#101820')=>{ctx.fillStyle=color;ctx.font=`${size>=40?700:400} ${size}px Arial`;ctx.fillText(s,x,y);};
    box(0,0,1400,900,'#FFF8E1',0);box(36,36,1328,828,'#FFFFFF');text('Сегодня — главное перед глазами',84,128,48);
    text('ВЫМЫШЛЕННЫЙ ПЛАНЕР · ЛОКАЛЬНЫЙ РИСУНОК',86,174,22,'#6A7478');
    for(const [i,label]of ['Написать сценарий','Собрать материалы','Посмотреть фильм'].entries()){
      const y=232+i*168;box(76,y,814,134,i===2?'#E5F3E8':'#F4F1E9');box(108,y+42,46,46,i===2?'#285A36':'#D2DCDB',8);text(i===2?'✓':'',116,y+77,34,'#FFFFFF');text(label,182,y+76,38);text(i===2?'Готово':'В плане',182,y+110,22,'#516162');
    }
    box(946,232,344,548,'#101820');text('Фокус дня',982,304,38,'#FFFFFF');text('Одна важная',982,388,30,'#FEE715');text('задача за раз',982,433,30,'#FEE715');text('Время для себя',982,685,26,'#FFFFFF');
    return document.querySelector('canvas').toDataURL('image/png').split(',')[1];
  });
  await writeFile('examples/product-ad/assets/planner-alternative.png',Buffer.from(data,'base64'));
}finally{await browser.close();}
