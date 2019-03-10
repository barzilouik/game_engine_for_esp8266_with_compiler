char s1[] = {0x00,0x00,0x90,0x00,0x00,0x09,0x89,0x90,0x00,0x98,0x88,0x89,0x09,0x88,0x89,0x89,0x09,0x89,0x98,0x89,0x98,0x98,0x88,0x90,0x98,0x98,0x99,0x00,0x09,0x09,0x09,0x09,0x00};
char s2[] = {0x00,0x90,0x90,0x90,0x09,0x89,0x89,0x89,0x98,0x88,0x88,0x89,0x09,0x88,0x88,0x89,0x99,0x89,0x88,0x89,0x00,0x98,0x88,0x90,0x00,0x09,0x98,0x90,0x00,0x00,0x09,0x09,0x00};
int cadrs[2];
cadrs[0] = s1;
cadrs[1] = s2;
char shatle[] = {0x00,0x01,0x10,0x00,0x00,0x01,0x10,0x00,0x00,0x1e,0xe1,0x00,0x00,0x11,0x11,0x00,0x00,0x01,0x10,0x00,0x00,0x01,0x10,0x00,0xc0,0x11,0x11,0x0c,0x11,0x21,0x12,0x11,0x00};
char stars[64];
char sprites[32];
char game[] = {0x11,0x10,0x11,0x10,0x11,0x01,0x10,0x11,0x10,0x00,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x00,0x11,0x10,0x10,0x10,0x10,0x11,0x10,0x10,0x10,0x10,0x10,0x00,0x10,0x10,0x11,0x10,0x10,0x10,0x10,0x00,0x10,0x11,0x00};
char over[] = {0x11,0x10,0x10,0x10,0x11,0x01,0x01,0x10,0x10,0x10,0x10,0x10,0x01,0x10,0x10,0x10,0x10,0x10,0x11,0x01,0x00,0x10,0x10,0x01,0x00,0x10,0x01,0x00,0x11,0x10,0x01,0x00,0x11,0x01,0x00,0x00};
char x,y,key,play;
int i,j;
void main()
{
while(1){
clearscreen();
x = 60;
y = 118;
play = 1;
getsprite(16,shatle);
for (j = 0; j < 16; j++)
	getsprite(j,cadrs[random(1)]);
for (i = 0; i < 32; i++){
		stars[i + 32] = random(120);
		stars[i] = random(254);
}
for (i = 0; i < 16; i++){
		sprites[i + 16] = random(120);
		sprites[i] = random(32);
}
while(play){
	for (j = 0; j < 32; j++){
		setcolor(0);
		putpixel(stars[j + 32],stars[j]);
		stars[j] = stars[j] + random(8);
		setcolor(1 + random(3));
		putpixel(stars[j + 32],stars[j]);
	}
	for (j = 0; j < 16; j++){
		getsprite(j,cadrs[random(1)]);
		sprites[j] = sprites[j] + random(2);
		if(sprites[j] > 112){
			if(((sprites[j + 16] + 8) > x) & (sprites[j + 16] < (x + 8)))
				play = 0;
		if(sprites[j] > 120){
				sprites[j + 16] = random(120);
				sprites[j] = 0;
				}
		}
		putsprite(j,sprites[j + 16],sprites[j]);
	}
	key = getkey();
	if((key == KEY_LEFT) & (x > 1)){
		x--;x--;}
	if((key == KEY_RIGHT) & (x < 119)){
		x++;x++;}
	putsprite(16, x, y);
	delayredraw();
}
putimage(game, 50, 70, 16, 5);
putimage(over, 70, 70, 14, 5);
while(getkey() == 0){};
}
}	
					
					