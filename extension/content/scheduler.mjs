export class ViewportSchedule {
  constructor() { this.y = 0; this.time = 0; this.speed = 0; this.direction = 1; this.latencies = []; this.lastScroll = 0; }
  scroll(y, time) {
    if (this.time && time > this.time) { const delta = y - this.y; this.speed = .6 * this.speed + .4 * Math.abs(delta) / Math.max(16,time-this.time); if (delta) this.direction = Math.sign(delta); }
    this.y=y; this.time=time; this.lastScroll=time;
  }
  completed(ms) { this.latencies.push(ms); if (this.latencies.length>30) this.latencies.shift(); }
  margin(height) { if(this.latencies.length<10)return height;const sorted=[...this.latencies].sort((a,b)=>a-b);return Math.round(Math.min(3*height,Math.max(height,this.speed*sorted[Math.floor(sorted.length*.9)]+height*.5))); }
  rank(rect, height) {
    if (!rect.width || !rect.height) return Infinity;
    if(rect.bottom>=0 && rect.top<=height)return Math.max(0,rect.top);
    const distance=this.direction>0?rect.top-height:-rect.bottom;
    if(distance>=0 && distance<=this.margin(height))return 10000+distance;
    if((rect.bottom<0 && rect.bottom>-200)||(rect.top>height && rect.top<height+200))return 20000+Math.abs(rect.top);
    return Infinity;
  }
}
