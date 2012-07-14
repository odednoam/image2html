function imageDataToPixels(imageData) {
	var pixels = [];
	for (var i = 0; i<imageData.length; i+=4) {
		pixels.push([imageData[i], imageData[i+1], imageData[i+2], imageData[i+3]]);
	}
	return pixels;
}
function createResizedImage(image, resizeFactor) {
	var newCanvas = document.createElement('canvas');
	newCanvas.width=image.width / resizeFactor;
	newCanvas.height=image.height / resizeFactor;
	var context = newCanvas.getContext('2d');
	context.drawImage(image, 0, 0, image.width, image.height, 0, 0, image.width / resizeFactor, image.height / resizeFactor);
	return context.getImageData(0,0,newCanvas.width, newCanvas.height);
}

function pixelIndex(x,y,width,height) {
	return x+y*width;
}
function imageToTable(width, height, pixels, cmap, alphaQ) {
	var table = [];
	for (var x = 0; x<width; ++x) {
		table.push([]);
		for (var y=0; y<height; ++y) {
			var pixel = pixelIndex(x,y,width,height);
			table[x].push({
				'color': cmap.map(pixels[pixel]), 
				'opacity': alphaQuantization(pixels[pixel][3],alphaQ),
				'colspan': 1, 
				'rowspan': 1});
		}
	}
	return table;
}

function alphaQuantization(value, alphaQ) {
	if (alphaQ == 0) return 1;
	return Math.round(value*alphaQ/255.0)/alphaQ; 
}

var EMPTY_CELL = undefined;

function compressRLE(width, height, direction, pixels, cmap, alphaQ) {
	var table = [];
	for (var x = 0; x<width; ++x) {
		table.push([]);
		for (var y=0; y<height; ++y) {
			var pixel = pixelIndex(x,y,width,height);
			var color = cmap.map(pixels[pixel]);
			var opacity = alphaQuantization(pixels[pixel][3],alphaQ);
			if (direction == 'h') {
				var x0 = x-1;
				while (x0>=0 && table[x0][y]==EMPTY_CELL) 
					--x0;
				if (x0>=0 && color==table[x0][y].color && opacity==table[x0][y].opacity) {
					++table[x0][y].colspan;
					table[x].push(EMPTY_CELL);
					continue;
				}
			}
			else if (direction == 'v') {
				var y0 = y-1;
				while (y0>=0 && table[x][y0]==EMPTY_CELL) 
					--y0;
				if (y0>=0 && color==table[x][y0].color && opacity==table[x][y0].opacity) {
					++table[x][y0].rowspan;
					table[x].push(EMPTY_CELL);
					continue;
				}
			}
			table[x].push({
				'color': color, 
				'opacity': opacity, 
				'colspan': 1, 
				'rowspan': 1});
		}
	}
	return table;
}

function findMaxSquareAt(x,y,totalWidth, totalHeight,isPixel) {
	var maxDimension = Math.min(totalWidth - x, totalHeight - y)
	for (var j=1; j<maxDimension; ++j) 
		for (var x0=0; x0<=j; ++x0)
			if (! (isPixel(x+j, y+x0) && isPixel(x+x0, y+j)))
				return j
	return maxDimension
}

function Rectangle(width, height, x, y) {
	this.width = width;
	this.height = height;
	this.x = x;
	this.y = y;
	this.consecutiveTo = function(other) {
		if (other == undefined) 
			return false;
		if (this.x==other.x && this.y == (other.y+other.height) && this.width==other.width)
			return true;
		if (this.y==other.y && this.x == (other.x+other.width) && this.height==other.height)
			return true;
		return false;
	}
	this.merge = function(other) {
		if (this.x==other.x && this.y == (other.y+other.height) && this.width==other.width)
			return new Rectangle(this.width, this.height + other.height, other.x, other.y);
		if (this.y==other.y && this.x == (other.x+other.width) && this.height==other.height)
			return new Rectangle(this.width + other.width, this.height, other.x, other.y);
	}
	this.forEachPoint = function(callback) {
		for (var x0=0; x0<this.width; ++x0)
			for (var y0=0; y0<this.height; ++y0)
				callback(this.x+x0,this.y+y0);
	}
}

function getRectangles(totalWidth, totalHeight, isPixel) {
	var rects = [];
	for (var x=0; x<totalWidth; ++x) {
		rects.push([]);
		for (var y=0; y<totalHeight; ++y) {
			rects[x].push(undefined);
		}
	}
	for (var i=0; i<totalWidth+totalHeight; ++i) {
		for (var x=0; x<i; ++x) {
			var y = i - x - 1;
			if (x >= totalWidth || y >= totalHeight) 
				continue;
			if (rects[x][y] == undefined && isPixel(x,y)) {
				var squareSize = findMaxSquareAt(x,y,totalWidth,totalHeight,isPixel);
				for (var k=0; k<squareSize; ++k) {
					if (rects[x+k][y] != undefined || rects[x][y+k] != undefined) {
						//collsion with a neighbor square; leave the older one (this is unoptimal)
						squareSize = k;
						break;
					}
				}
				var currentRect = new Rectangle(squareSize, squareSize, x, y);
				// see if the rectangle in this point continues the rectangles adjacent to it
				do {
					var stop = true;
					var x0=currentRect.x, y0=currentRect.y;
					if (y0>0 && currentRect.consecutiveTo(rects[x0][y0-1])) {
						currentRect = currentRect.merge(rects[x0][y0-1]);
						stop=false;
					}
					if (x0>0 && currentRect.consecutiveTo(rects[x0-1][y0])) {
						currentRect = currentRect.merge(rects[x0-1][y0]);
						stop=false;
					}
				} while (!stop);
				currentRect.forEachPoint(function(x,y) {rects[x][y]=currentRect;})
			}
		}
	}
	var ret = [];
	for (var x=0; x<totalWidth; ++x)
		for (var y=0; y<totalHeight; ++y)
			if (rects[x][y]!= undefined && rects[x][y].x == x && rects[x][y].y == y)
				ret.push(rects[x][y]);
	return ret;
}

function compress2dRle(width, height, pixels, cmap, alphaQ) {
	var table = [];
	for (var x =0; x<width; ++x) {
		table.push([]);
		for (var y=0; y<height; ++y) {
			table[x].push(undefined);
		}
	}
	var colorSet = {}
	for (var x =0; x<width; ++x)
		for (var y=0; y<height; ++y) {
			var pixel = pixelIndex(x,y,width,height);
			var color = cmap.map(pixels[pixel]);
			var opacity = alphaQuantization(pixels[pixel][3],alphaQ);
			colorSet[[color,opacity]] = [color,opacity];
		}
	var count=0;
	for (var c in colorSet) {
		++count;
		var distinctColor = colorSet[c];
		rects = getRectangles(width, height, function(x,y) {
			var pixel = pixelIndex(x,y,width,height);
			var color = cmap.map(pixels[pixel]);
			var opacity = alphaQuantization(pixels[pixel][3],alphaQ);
			return color==distinctColor[0] && opacity == distinctColor[1];
		});
		for (var i=0; i<rects.length; ++i) {
			table[rects[i].x][rects[i].y] = {
				'color': distinctColor[0],
				'opacity': distinctColor[1], 
				'colspan': rects[i].width, 
				'rowspan': rects[i].height
			};
		}
	}
	console.log("Color count: " + count);
	return table;
}


function decimalToHex(d, padding) {
	var hex = Number(d).toString(16);
	padding = typeof (padding) === "undefined" || padding === null ? padding = 2 : padding;

	while (hex.length < padding) {
		hex = "0" + hex;
	}
	return hex;
}

function colorToHex(color) {
	return decimalToHex(color[0],2) +  decimalToHex(color[1],2) + decimalToHex(color[2],2);
}
var CLASS_NAME_CHARSET = "abcdefghijklmnopqrstuvwxyz";

function createClassName(classIndex) {
	var numDigits = 1;
	var startOffset = 0;
	do {
		var spanOfCurrentNumDigits = Math.pow(CLASS_NAME_CHARSET.length,numDigits);
		if ((classIndex - startOffset)<spanOfCurrentNumDigits)
			break;
		startOffset += spanOfCurrentNumDigits;
		++numDigits;
	} while (true);
	var className = "";
	var digit = (classIndex - startOffset);
	for (var i=0; i<numDigits; ++i)
	{
		className = CLASS_NAME_CHARSET[digit % CLASS_NAME_CHARSET.length] + className;
		digit = Math.floor(digit / CLASS_NAME_CHARSET.length);
	}
	return className;
}

function createUniqueClassName() {
	var numLetters = 8
	var randomNumber = Math.floor(Math.random() * Math.pow(10, numLetters))
	var className = "";
	for (var i=0; i<numLetters;++i)
	{
		className = CLASS_NAME_CHARSET[randomNumber % CLASS_NAME_CHARSET.length] + className;
		randomNumber = Math.floor(randomNumber / CLASS_NAME_CHARSET.length);
	}
	return className;
}

function createTableHTML(table, width, height, config) { 
	var histogram = {}
	for (var y=0; y<height; ++y) 
		for (var x=0; x<width; ++x) 
			if (table[x][y]!=undefined) {
				var c = table[x][y].color;
				if (histogram[c] == undefined) 
					histogram[c]={'color':c, 'count':0, 'opacityHistogram':{}};
				var item = histogram[c];
				++item.count;
				var o = table[x][y].opacity;
				if (item.opacityHistogram[o] == undefined) 
					item.opacityHistogram[o] = 0;
				++item.opacityHistogram[o];
			}
	var dominantColor;
	for (var color in histogram) {
		var max = undefined;
		for (var o in color.opacityHistogram) 
			if (max == undefined || 
				histogram[color].opacityHistogram[o]>histogram[color].opacityHistogram[max])
				max = o;
		histogram[color].mostCommonOpacity = max;
		if (dominantColor==undefined || histogram[color].count>dominantColor.count) {
			dominantColor = histogram[color];
		}
	}
	var tableHTML;
	if (config.useClasses) {
		var sortedHistogram = [];
		for (var key in histogram) {
			sortedHistogram.push(histogram[key]);
		}
		var uniqueName = createUniqueClassName();
		sortedHistogram.sort(function (a,b){return b.count-a.count;});
		tableHTML = "<style>";
		tableHTML += "."+uniqueName+"{border:0px;border-collapse:collapse;border-spacing:0;height:" + (height*config.resizeFactor) + "px;width:" + (width*config.resizeFactor) +"px;padding:0px;color:white}\n";
		
		tableHTML += "table."+uniqueName+">tbody>tr>td{width:1px;max-height:1px;opacity:" + dominantColor.mostCommonOpacity + ";background-color:#" + colorToHex(dominantColor.color)+"}\n";
		tableHTML += "table."+uniqueName+">tbody>tr>td." + CLASS_NAME_CHARSET[0] + "{width:1px;height:1px;opacity:0}\n";
		tableHTML += "table."+uniqueName+">tbody>tr." + CLASS_NAME_CHARSET[0] + "{height:1px}\n";
		var colorClasses = {};
		for (var i=0; i<sortedHistogram.length; ++i) {
			var item = sortedHistogram[i];
			var className = createClassName(i+1);
			colorClasses[item.color] = {'name':className, 'mostCommonOpacity': item.mostCommonOpacity};
			tableHTML += "table."+uniqueName+">tbody>tr>td." + className + "{background-color:#" + colorToHex(item.color);// + " !important";
			if (item != dominantColor && item.mostCommonOpacity != 1.0)
				tableHTML+= ";opacity:" + item.mostCommonOpacity;// + " !important"
			tableHTML += "}\n";
		}
		var opacityClasses = {};
		if (config.useTransparency) {
			for (var i=0; i<=config.alphaQ; ++i) {
				var className = createClassName(sortedHistogram.length+i+1);
				opacityClasses[(1.0/config.alphaQ)*i] = className;
				tableHTML += "table."+uniqueName+">tbody>tr>td." + className + "{opacity:" + ((1.0/config.alphaQ)*i) + "}\n";//  + " !important}\n";
			}
		}
		tableHTML += "</style>";
		tableHTML += "<table class='"+uniqueName+"'>";
		tableHTML += "<tr>";
		for (var x=0; x<=width; ++x) {
			tableHTML += "<td class="+ CLASS_NAME_CHARSET[0]+ "></td>";
		}
		tableHTML += "</tr>";
		for (var y=0; y<height; ++y) {
			tableHTML += "<tr class="+ CLASS_NAME_CHARSET[0] +"><td class="+ CLASS_NAME_CHARSET[0]+ "></td>";
			for (var x=0; x<width; ++x) {
				if (table[x][y] == EMPTY_CELL) continue;
				var color = table[x][y].color;
				var opacity = table[x][y].opacity;
				var className = "";
				if (color != dominantColor.color)
					className = colorClasses[color].name;
				if (config.useTransparency && opacity!=colorClasses[color].mostCommonOpacity) {
					if (className == "") 
						className = opacityClasses[opacity];
					else
						className = opacityClasses[opacity] + " " + className;
				}
				tableHTML += "<td";
				if (className != "") {
					if (className.indexOf(" ")>0)
						tableHTML+= " class=\"" + className + "\"";
					else
						tableHTML+= " class='" + className + "'";
				}
				if (table[x][y].colspan > 1)
					tableHTML += " colspan='" + table[x][y].colspan + "'";
				if (table[x][y].rowspan > 1)
					tableHTML += " rowspan='" + table[x][y].rowspan + "'";
				tableHTML += "></td>";
			}
			tableHTML += "</tr>";
		}
		tableHTML += "</table>";
	}
	else {
		tableHTML = "<table style='border-collapse:collapse;border-spacing:0;height:" + (height*config.resizeFactor) + "px;width:" + (width*config.resizeFactor) +"px;padding:0px;color:white;background-color:#" + colorToHex(dominantColor.color) + "'>";
		tableHTML += "<tr>";
		for (var x=0; x<=width; ++x) {
			tableHTML += "<td style='width:" + config.resizeFactor + "px;opacity:0'></td>";
		}
		tableHTML += "</tr>";
		for (var y=0; y<height; ++y) {
			tableHTML += "<tr style='height:" + config.resizeFactor + "px'><td style='opacity:0'></td>";
			for (var x=0; x<width; ++x) {
				if (table[x][y] == EMPTY_CELL) continue;
				var style = "";
				if (table[x][y].color != dominantColor.color)
					style += "background-color:#" + colorToHex(table[x][y].color);
				if (config.useTransparency && table[x][y].opacity<1) {
					if (style != "") style += ";";
					style += "opacity:" + table[x][y].opacity;
				}
				tableHTML += "<td";
				if (style != "") tableHTML+= " style='" + style + "'";
				if (table[x][y].colspan > 1)
					tableHTML += " colspan='" + table[x][y].colspan + "'";
				if (table[x][y].rowspan > 1)
					tableHTML += " rowspan='" + table[x][y].rowspan + "'";
				tableHTML += "></td>";
			}
			tableHTML += "</tr>";
		}
		tableHTML += "</table>";
	}
	if (! config.strictHtml) {
		tableHTML = tableHTML.replace(/<\/td>/g,"").replace(/<\/tr>/g,"").replace(/\'/g,"");
	}
	return tableHTML;
}

function imageToHtml(config, image) {
	// resize image as requested
	var imageData = createResizedImage(image, config.resizeFactor);
	
	// reduce colors
	var pixels = imageDataToPixels(imageData.data);
	var cmap = MMCQ.quantize(pixels, config.colorQ)
	// Apply compression
	var table;
	switch (config.algorithm) {
		case 'none':
			table = imageToTable(imageData.width, imageData.height, pixels, cmap, config.alphaQ);
			break;
		case 'h_rle':
			table = compressRLE(imageData.width, imageData.height, 'h', pixels, cmap, config.alphaQ);
			break;
		case 'v_rle':
			table = compressRLE(imageData.width, imageData.height, 'v', pixels, cmap, config.alphaQ);
			break;
		case '2d_rle':
			table = compress2dRle(imageData.width, imageData.height, pixels, cmap, config.alphaQ);
			break;
	}
	// Create HTML
	return createTableHTML(table, imageData.width, imageData.height, config);
}

