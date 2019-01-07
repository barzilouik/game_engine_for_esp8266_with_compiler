"use strict";
//разбивка на токены
function tokenize(s) {
	var tokens = [];
	var thisToken = 0;
	var l;
	var lastDefine;

	//упрощенный вариант #define, лишь замена
	function define(s) {
		lastDefine = [''];
		while (lastDefine.length != 0) {
			lastDefine = [];
			s = s.replace(/#define\s*([^\s]*)\s*([^\n]*)/, function (str, def, repl, offset, s) {
					lastDefine = [def, repl];
					return ' ';
				});
			if (lastDefine.length > 0)
				s = s.replace(new RegExp(lastDefine[0], 'g'), lastDefine[1]);
		}
		return s;
	}

	s = define(s);
	s = s.replace(/#include[^\n]*/g, ''); //удаление инклюдов, дабы не мешали
	s = s.replace(/(\w*\d*)\s*([\/\*\+\-])\s*=([^;]*)/g, '$1=$1$2($3)'); //замена сокращенной записи операции с переменной
	l = s.length;
	tokens[0] = '';
	for (var i = 0; i < l; i++) {
		switch (s[i]) {
		case '"':
			//обработка строки
			if (tokens[thisToken] != '')
				thisToken++;
			tokens[thisToken] = s[i++];
			while (i < l && s[i] != '"') {
				tokens[thisToken] += s[i++];
				//замена специальных символов
				if (s[i] == '\\' && s[i + 1] == '"') {
					tokens[thisToken] += '\\"';
					i += 2;
				}
			}
			tokens[thisToken] += s[i];
			thisToken++;
			tokens[thisToken] = '';
			break;
		case '\'':
			//обработка отдельных символов
			if (tokens[thisToken] != '')
				thisToken++;
			if (s[i + 2] == '\'') {
				tokens[thisToken] = '' + s.charCodeAt(i + 1);
				thisToken++;
				tokens[thisToken] = '';
				i += 2;
			}
			break;
		case '=':
			if (s[i - 1] == '=' || s[i - 1] == '!') {
				tokens[thisToken - 1] += '=';
				break;
			}
		case '+':
		case '-':
		case '*':
		case '%':
		case '/':
			//если комментарии, то убираем, оставляя переводы строк
			if (s[i + 1] == '/') {
				while (s[i + 1] != '\n')
					i++;
				break;
			}
			if (s[i + 1] == '*') {
				i += 2;
				while (!(s[i] == '*' && s[i + 1] == '/')) {
					if (s[i] == '\n') {
						if (tokens[thisToken] != '')
							thisToken++;
						tokens[thisToken] = s[i];
						thisToken++;
						tokens[thisToken] = '';
					}
					i++;
					if (i >= l)
						break;
				}
				i++;
				break;
			}
		case '>':
		case '<':
		case '!':
		case '&':
		case '^':
		case '|':
		case '(':
		case ')':
		case '{':
		case '}':
		case '[':
		case ']':
		case ';':
		case ':':
		case ',':
		case '\n':
			if (tokens[thisToken] != '')
				thisToken++;
			tokens[thisToken] = s[i];
			if ((s[i] == '>' || s[i] == '<') && s[i + 1] == '=') {
				i++;
				tokens[thisToken] += s[i];
			}
			thisToken++;
			tokens[thisToken] = '';
			break;
		case '\t':
		case ' ':
			//убираем лишние пробельные символы
			while (l < i && s[i + 1] == ' ')
				i++;
			if (tokens[thisToken] != '') {
				thisToken++;
				tokens[thisToken] = '';
			}
			break;
		default:
			tokens[thisToken] += s[i];
		}
	}
	return tokens;
}

function compile(t) {
	var asm = []; //основной ассемблерный код
	var dataAsm = []; //ассемблерный код, который будет добавлен в конце основного
	var thisTokenNumber = 0; //номер текущего токена
	var thisToken; //текущий токен
	var lastToken; //предыдущий токен
	var varTable = []; //таблица переменных
	var localVarTable = []; //таблица локальных переменных
	var functionTable = []; //таблица, содержащая имена функций и их исходный код на ассемблере
	var isIntoFunction = false; //находимся ли мы в теле функции
	var functionVarTable = []; //таблица переменных, указанных в объявлении текущей обрабатываемой функции
	var lineCount = 0; //номер текущей строки
	var registerCount = 1; //указатель на используемый в данный момент регистор процессора
	var lastEndString = 0; //указатель на токен, являющийся последним в предыдущей строке
	var labelNumber = 0; //номер ссылки, необходим для создания уникальных имен ссылок
	var localStackLength = 0; //используется в функциях для работы с локальными переменными относительно указателя стека
	var switchStack = []; //указывает на последний switch, необходимо для обработки break
	//получаем следующий токен, возвращаем false если следующего токена не существует
	function getToken() {
		lastToken = thisToken;
		if (thisTokenNumber < t.length) {
			thisToken = t[thisTokenNumber];
			thisTokenNumber++;
			return true;
		}
		thisToken = false;
		return false;
	}
	//откатываемся к предыдущему токену
	function previousToken() {
		if (thisTokenNumber > 1) {
			thisTokenNumber--;
			thisToken = t[thisTokenNumber - 1];
			if (thisTokenNumber > 1) {
				lastToken = t[thisTokenNumber - 2];
			} else {
				lastToken = '';
			}
			return true;
		} else
			return false;
	}
	//получение ранга операции для правильного порядка выполнения математических операций
	function getRangOperation(t) {
		switch (t) {
		case '>':
		case '<':
		case '!':
		case '==':
		case '!=':
		case '<=':
		case '>=':
		case '|':
		case '&':
		case '^':
			return 1;
		case '+':
		case '-':
			return 2;
		case '*':
		case '/':
		case '%':
			return 3;
		}
		return 0;
	}

	//регистрация функции: имя, тип возвращаемых данных, операнды, объявлена ли функция, исходный код, нужно ли вставлять функцию вместо перехода
	function registerFunction(name, ftype, operands, declar, asm, inline, varLength) {
		var pos = -1;
		for (var i = 0; i < functionTable.length; i++) {
			if (functionTable[i].name == name)
				pos = i;
		}
		if (pos >= 0 && functionTable[pos].declar == 1) {
			info("" + lineCount + " функция " + name + " уже была объявлена");
		} else if (pos == -1) {
			// имя функции, тип возвращаемых данных, операнды, объявлена ли функция, используется ли функция, код функции, нужно ли вставлять функцию вместо перехода
			functionTable.push({
				name: name,
				type: ftype,
				operands: operands,
				declar: declar,
				use: 0,
				asm: asm,
				inline: inline,
				varLength: varLength
			});
		} else {
			if (!(functionTable[pos].type == ftype)) {
				info("" + lineCount + " функция " + name + " не соответствует прототипу");
			}
			functionTable[pos].declar = declar;
			functionTable[pos].asm = asm;
			functionTable[pos].varLength = varLength;
		}
	}
	//обработка встреченной в коде функции
	function addFunction(type) {
		var name = thisToken;
		var start = 0;
		localVarTable = [];
		functionVarTable = [];
		registerCount = 1;
		//main вызывается всегда, так что пока что просто ее перепрыгиваем
		if (name == 'main')
			asm.push(' JMP _end_main');
		getToken();
		getToken();
		//добавляем в таблицу переменные функции, сразу тип, затем имя, подряд для упрощения поиска (имя все равно не может соответствовать типу
		while (thisToken != ')') {
			if (isType(thisToken))
				functionVarTable.push(thisToken);
			else {
				info("" + lineCount + " ожидалось определение типа");
				return false;
			}
			getToken();
			if (!thisToken)
				return;
			if (thisToken == ')' && lastToken == 'void' && functionVarTable.length == 1) {
				functionVarTable = [];
			} else {
				functionVarTable.push(thisToken);
				getToken();
				if (thisToken == '[') {
					getToken();
					getToken();
				}
				if (thisToken == ',')
					getToken();
				else if (thisToken != ')') {
					info("" + lineCount + " ожидалась запятая или закрывающая скобка");
					return false;
				}
			}
		}
		getToken();
		removeNewLine();
		//если следует точка с запятой, значит тело функции будет описано дальше. Регистрируем функцию, что бы можно было ее использовать
		if (thisToken == ';') {
			registerFunction(name, type, functionVarTable, 0, [], 0, 0);
		}
		//иначе обрабатываем содержимое функции
		else {
			isIntoFunction = true;
			registerFunction(name, type, functionVarTable, 0, [], 0, 0);
			if (thisToken != '{') {
				info("" + lineCount + " ожидалась фигурная открывающая скобка");
				return false;
			}
			//запоминаем начала ассемблерного кода, принадлежащего функции
			start = asm.length;
			asm.push('_' + name + ':');
			skipBrace();
			asm.push(' RET');
			//если это main указываем окончание функции
			if (name == 'main') {
				registerFunction(name, type, functionVarTable, 1, [], false, localVarTable.length);
				asm.push('_end_main:');
			}
			//иначе вырезаем весь код функции из таблицы asm и сохраняем в таблицу функций. Это позволит в итоге добавить в финальный код только используемые функции
			else
				registerFunction(name, type, functionVarTable, 1, asm.splice(start, asm.length - start), false, localVarTable.length);
			localVarTable = [];
			isIntoFunction = false;
		}
	}
	//вставка кода функции
	function inlineFunction(func) {
		getToken();
		if (thisToken != ')') {
			previousToken();
			while (!(thisToken == ')' || thisToken == ';')) {
				i++;
				getToken();
				if (!thisToken)
					return;
				while (!(thisToken == ',' || thisToken == ')' || thisToken == ';')) {
					execut();
					if (!thisToken)
						return;
					if (getRangOperation(thisToken) > 0)
						execut();
					else if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
						getToken();
				}
				if (i > func.operands.length / 2 && !longArg) {
					info("" + lineCount + " ожидалась закрывающая скобка в функции " + t);
					return false;
				}
			}
		}
		//проверяем соответствие количества аргументов заявленному
		if (i < func.operands.length / 2 && !longArg) {
			info("" + lineCount + " ожидался аргумент в функции " + t);
			return false;
		}
		asm.push(func.asm.replace(/[Rr]\%(\d)/g, function (str, reg, offset, s) {
				return 'R' + (registerCount - parseInt(reg));
			}));
		registerCount -= func.operands.length / 2;
		if (func.type != 'void')
			registerCount++;
		getToken();
		if (getRangOperation(thisToken) > 0)
			execut();
		else if (thisToken == ';')
			previousToken();
	}
	//обработка вызова функции
	function callFunction(t) {
		var func;
		var longArg = false;
		var operandsCount = 0;
		var pushOnStack = 0;
		localStackLength = 0;
		for (var i = 0; i < functionTable.length; i++) {
			if (functionTable[i].name == t){
				func = functionTable[i];
				break;
			}
		}
		//проверка на неопределенное количество аргументов
		if (func.operands.length > 0 && func.operands[func.operands.length - 1] == '...')
			longArg = true;
		getToken();
		if (thisToken != '(') {
			info("" + lineCount + " ожидалась открывающая скобка в функции " + t);
			return false;
		}
		if (func.inline == true) {
			inlineFunction(func);
			return;
		}
		func.use++;
		i = 0;
		if (registerCount > 1) {
			//если функция должна вернуть значение, то складываем на стек все значения регистров, содержащих данные, дабы функция их не повредила
			if (func.type != 'void') {
				asm.push(' PUSHN R' + (registerCount - 1));
				pushOnStack = registerCount - 1;
				localStackLength += (registerCount - 1);
			} else
				info('' + lineCount + ' функция ' + func.name + ' не может возвращать значение');
		} else
			registerCount++;
		getToken();
		if (thisToken != ')') {
			previousToken();
			while (!(thisToken == ')' || thisToken == ';')) {
				i++;
				getToken();
				if (!thisToken)
					return;
				while (!(thisToken == ',' || thisToken == ')' || thisToken == ';')) {
					execut();
					if (!thisToken)
						return;
					if (getRangOperation(thisToken) > 0)
						execut();
					else if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
						getToken();
				}
				registerCount--;
				operandsCount++;
				asm.push(' PUSH R' + registerCount);
				localStackLength += 1;
				if (i > func.operands.length / 2 && !longArg) {
					info("" + lineCount + " ожидалась закрывающая скобка в функции " + t);
					return false;
				}
			}
		}
		//проверяем соответствие количества аргументов заявленному
		if (i < func.operands.length / 2 && !longArg) {
			info("" + lineCount + " ожидался аргумент в функции " + t);
			return false;
		}
		if (longArg)
			asm.push(' LDC R1,' + (operandsCount * 2));
		//освобождаем место на стеке для переменных
		if (func.varLength > 0) {
			if (func.varLength < 15)
				asm.push(' DEC R0,' + func.varLength);
			else
				asm.push(' LDC R15,' + func.varLength + '\n SUB R0,R15');
		}
		asm.push(' CALL _' + func.name);
		//функции возвращают значение в первый регистр, переносим в нужный нам
		if (func.type != 'void') {
			if (registerCount != 1) {
				asm.push(' MOV R' + registerCount + ',R1');
			}
		}
		//восстанавливаем указатель стека
		if ((operandsCount * 2 + func.varLength) > 0xf)
			asm.push(' LDC R15,' + (operandsCount * 2 + func.varLength) + '\n ADD R0,R15');
		else if ((operandsCount * 2 + func.varLength) > 0)
			asm.push(' INC R0,' + (operandsCount * 2 + func.varLength));
		//возвращаем все данные регистров из стека
		if (registerCount > 1) {
			if (pushOnStack > 0)
				asm.push(' POPN R' + pushOnStack);
			localStackLength = 0;
		}
		registerCount++;
		getToken();
		if (getRangOperation(thisToken) > 0)
			execut();
		else if (thisToken == ';')
			previousToken();
	}
	//добавляем новую переменную в таблицу
	function addVar(type) {
		if (isIntoFunction) {
			localVarTable.push(type);
			localVarTable.push(thisToken);
		} else {
			varTable.push({
				name: thisToken,
				type: type,
				length: 1
			});
			asm.push(' _' + thisToken + ' word ? ');
		}
	}
	//возвращаем тип и имя переменной, если такая существует
	function getVar(t) {
		for (var i = 0; i < varTable.length; i++) {
			if (varTable[i].name == t)
				return varTable[i];
		}
		return {
			name: 'null',
			type: 'void',
			length: 1
		}
	}
	//обрабатываем переменные, данные которых содержатся на стеке
	function localVarToken() {
		var type,l;
		var point = false;
		if(lastToken == '*' && registerCount == 1)
			point = true;
		var number = functionVarTable.indexOf(thisToken);
		if (number == -1) {
			number = localVarTable.indexOf(thisToken);
			type = localVarTable[number - 1];
			l = localStackLength * 2 + number + 1; //позиция переменной относительно указателя на стек
		} else {
			type = functionVarTable[number - 1];
			//number += localVarTable.length;
			l = localStackLength * 2 + functionVarTable.length + localVarTable.length - number + 1;
		}
		var token = thisToken;
		getToken();
		//если переменная является массивом
		if (thisToken == '[') {
			//вычисление номера ячейки массива
			while (thisToken != ']') {
				getToken();
				if (!thisToken)
					return;
				execut();
			}
			getToken();
			//загрузка ячейки массива
			if (thisToken != '=') {
				previousToken();
				if (type == 'char' || type == '*char') {
					if(type == '*char' && !point){
						asm.push(' LDI R' + (registerCount + 1) + ',(' + l + '+R0) ;' + token);
						asm.push(' LDC R' + (registerCount - 1) + ',(R' + (registerCount + 1) + '+R' + (registerCount - 1) + ')');
					} else
						info("" + lineCount + " работа с локальными массивами не поддерживается ");
				} else {
					if(type == '*int' && !point){
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' LDI R' + (registerCount + 1) + ',(' + l + '+R0) ;' + token);
						asm.push(' LDC R' + (registerCount - 1) + ',(R' + (registerCount + 1) + '+R' + (registerCount - 1) + ')');
					} else
						info("" + lineCount + " работа с локальными массивами не поддерживается ");
				}
			}
			//сохранение ячейки массива
			else {
				getToken();
				execut();
				getToken();
				//если за переменной следует математическая операция, то продолжаем трансляцию кода
				if (getRangOperation(thisToken) > 0)
					execut();
				registerCount--;
				if (type == 'char' || type == '*char') {
					if(type == '*char' && !point){
						asm.push(' LDI R' + (registerCount + 1) + ',(' + l + '+R0) ;' + token);
						asm.push(' STC (R' + (registerCount + 1) + '+R' + (registerCount - 1) + '),R' + registerCount);
					} else{
						info("" + lineCount + " работа с локальными массивами не поддерживается ");
					}
				} else {
					if(type == '*int' && !point){
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' LDI R' + (registerCount + 1) + ',(' + l + '+R0) ;' + token);
						asm.push(' STC (R' + (registerCount + 1) + '+R' + (registerCount - 1) + '),R' + registerCount);
					} else{
						info("" + lineCount + " работа с локальными массивами не поддерживается ");
					}
				}
				registerCount--;
			}
		}
		//получить значение переменной
		else if (thisToken != '=') {
			previousToken();
			if (type == 'char')
				asm.push(' LDC R' + registerCount + ',(' + l + '+R0) ;' + token);
			else
				asm.push(' LDI R' + registerCount + ',(' + l + '+R0) ;' + token);
			registerCount++;
		}
		//присвоить значение переменной
		else {
			getToken();
			execut();
			getToken();
			if (getRangOperation(thisToken) > 0)
				execut();
			registerCount--;
			if (type == 'char')
				asm.push(' STC (' + l + '+R0),R' + registerCount + ' ;' + token);
			else
				asm.push(' STI (' + l + '+R0),R' + registerCount + ' ;' + token);
		}
	}
	//преобразование строки в формат, понятный ассемблеру, с заменой спецсимволов на их числовой код
	function pushString() {
		var s = '';
		while (thisToken[0] == '"') {
			for (var i = 0; i < thisToken.length; i++) {
				if (thisToken[i] == ';') {
					s += '",59,"';
				} else if (thisToken[i] == '\\') {
					i++;
					if (thisToken[i] == '\\')
						s += '",92,"';
					else if (thisToken[i] == 'n')
						s += '",10,"';
					else if (thisToken[i] == 't')
						s += '",9,"';
					else if (thisToken[i] == '"')
						s += '",34,"';
				} else
					s += thisToken[i];
			}
			getToken();
			removeNewLine();
			s += ',';
		}
		previousToken();
		//dataAsm вставляется в таблицу asm после завершения компиляции
		dataAsm.push('DB ' + s + '0');
	}
	//добавляем массив
	function addArray(type) {
		var name = lastToken;
		var length = 1;
		var buf = '';
		getToken();
		//количество элементов не указано
		if (thisToken == ']') {
			getToken();
			if (thisToken != '=')
				info("" + lineCount + " не указана длина массива");
			else
				getToken();
			//массив это строка символов
			if (thisToken[0] == '"') {
				length = thisToken.length - 2;
				dataAsm.push('_' + name + ':');
				pushString();
				varTable.push({
					name: name,
					type: type,
					length: length
				});
			}
			//массив уже заполнен, считаем количество элементов
			else if (thisToken == '{') {
				while (thisToken && thisToken != '}') {
					getToken();
					if (!thisToken)
						return;
					buf += parseInt(thisToken) + ',';
					length++;
					getToken();
					if (!(thisToken == '}' || thisToken == ','))
						info("" + lineCount + " неправильное объявление массива");
				}
				if (type == 'int')
					dataAsm.push('_' + name + ': \n DW ' + buf + '0');
				else if (type == 'char')
					dataAsm.push('_' + name + ': \n DB ' + buf + '0');
				varTable.push({
					name: name,
					type: type,
					length: length
				});
			}
		}
		//количество элементов указано
		else if (isNumber(thisToken)) {
			length = thisToken * 1;
			dataAsm.push(' _' + name + ' word ' + length + ' dup(?)');
			varTable.push({
				name: name,
				type: type,
				length: length
			});
			getToken();
			if (thisToken != ']')
				info("" + lineCount + " неправильное объявление массива");
		} else
			info("" + lineCount + " неправильное объявление массива");
	}
	//проверка, является ли токен t функцией
	function isFunction(t) {
		for (var i = 0; i < functionTable.length; i++) {
			if (functionTable[i].name == t)
				return true;
		}
		return false;
	}
	//проверка, является ли токен t переменной
	function isVar(t) {
		for (var i = 0; i < varTable.length; i++) {
			if (varTable[i].name == t)
				return true;
		}
		return false;
	}
	//проверка, является ли токен t объявлением типа
	function isType(t) {
		if (t == 'int' || t == 'char' || t == 'void')
			return true;
		if (t == '*int' || t == '*char' || t == '*void')
			return true;
		return false;
	}
	//проверка, является ли токен t числом
	function isNumber(t) {
		return !isNaN(parseFloat(t)) && isFinite(t);
	}
	//обрабатываем переменную
	function varToken() {
		var v = getVar(thisToken);
		var point = false;
		if(lastToken == '*' && registerCount == 1)
			point = true;
		getToken();
		//если переменная является массивом
		if (thisToken == '[') {
			//вычисление номера ячейки массива
			while (thisToken != ']') {
				getToken();
				if (!thisToken)
					return;
				execut();
			}
			getToken();
			//загрузка ячейки массива
			if (thisToken != '=') {
				previousToken();
				if (v.type == 'char' || v.type == '*char') {
					if(v.type == '*char' && !point){
						asm.push(' LDI R' + registerCount + ',(_' + v.name +')');
						asm.push(' LDC R' + (registerCount - 1) + ',(R' + registerCount + '+R' + (registerCount - 1) + ')');
					} else
						asm.push(' LDC R' + (registerCount - 1) + ',(_' + v.name + '+R' + (registerCount - 1) + ')');
				} else {
					if(v.type == '*int' && !point){
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' LDI R' + registerCount + ',(_' + v.name +')');
						asm.push(' LDI R' + (registerCount - 1) + ',(R' + registerCount + '+R' + (registerCount - 1) + ')');
					} else{
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' LDI R' + (registerCount - 1) + ',(_' + v.name + '+R' + (registerCount - 1) + ')');
					}
				}
			}
			//сохранение ячейки массива
			else {
				getToken();
				execut();
				getToken();
				//если за переменной следует математическая операция, то продолжаем трансляцию кода
				if (getRangOperation(thisToken) > 0)
					execut();
				registerCount--;
				if (v.type == 'char' || v.type == '*char') {
					if(v.type == '*char' && !point){
						asm.push(' LDI R' + (registerCount + 1) + ',(_' + v.name +')');
						asm.push(' STC (R' + (registerCount + 1) + '+R' + (registerCount - 1) + '),R' + registerCount);
					} else
						asm.push(' STC (_' + v.name + '+R' + (registerCount - 1) + '),R' + registerCount);
				} else {
					if(v.type == '*int' && !point){
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' LDI R' + (registerCount + 1) + ',(_' + v.name +')');
						asm.push(' STI (R' + (registerCount + 1) + '+R' + (registerCount - 1) + '),R' + registerCount);
					} else{
						asm.push(' LDC R15,2 \n MUL R' + (registerCount - 1) + ',R15');
						asm.push(' STI (_' + v.name + '+R' + (registerCount - 1) + '),R' + registerCount);
					}
				}
				registerCount--;
			}
		}
		//загрузка значения переменной
		else if (thisToken != '=') {
			previousToken();
			if (v.length > 1) {
				asm.push(' LDI R' + registerCount + ',_' + thisToken);
			} else if (v.type == 'char' || v.type == '*char') {
				asm.push(' LDC R' + registerCount + ',(_' + thisToken + ')');
			} else {
				asm.push(' LDI R' + registerCount + ',(_' + thisToken + ')');
			}
			registerCount++;
		}
		//присваивание значения переменной
		else
			assigment();
	}
	//обработка возврата из функции
	function returnToken() {
		registerCount = 2;
		while (thisToken != ';') {
			getToken();
			if (!thisToken)
				return;
			execut();
		}
		registerCount--;
		asm.push(' MOV R1,R' + registerCount);
		registerCount--;
		if (registerCount > 1) {
			info("" + lineCount + " неверное количество аргументов");
		}
		registerCount == 1;
		asm.push(' RET ');
	}
	//присваивание значения переменной
	function assigment() {
		var variable = lastToken;
		registerCount = 2;
		if (localVarTable.indexOf(variable) > -1) {
			previousToken();
			localVarToken();
		} else {
			getToken();
			execut();
			getToken();
			if (getRangOperation(thisToken) > 0)
				execut();
			registerCount--;
			asm.push(' STI (_' + variable + '),R' + registerCount);
		}
	}
	//обработка сложения/вычитания/декремента/инкремента
	function addSub() {
		var variable = lastToken;
		var operation = thisToken;
		getToken();
		//если инкремент
		if (thisToken == '+' && operation == '+') {
			//если инкремент следует за переменной (var++)
			if (isVar(variable) || localVarTable.indexOf(variable) > -1 || functionVarTable.indexOf(variable) > -1) {
				if (isVar(variable))
					asm.push(' INC _' + variable);
				else if (localVarTable.indexOf(variable)) {
					if (registerCount == 1) {
						asm.push(' LDI R' + registerCount + ',(' + (localVarTable.indexOf(variable) + 1) + '+R0)');
						registerCount++;
					}
					asm.push(' MOV R' + registerCount + ',R' + (registerCount - 1));
					asm.push(' INC R' + registerCount);
					asm.push(' STI (' + (localVarTable.indexOf(variable) + 1) + '+R0),R' + registerCount);
				}
			}
			//если переменная следует за инкрементом (++var)
			else {
				getToken();
				if (isVar(thisToken)) {
					asm.push(' INC _' + thisToken);
					execut();
				} else if (localVarTable.indexOf(thisToken)) {
					asm.push(' LDI R' + registerCount + ',(' + (localVarTable.indexOf(thisToken) + 1) + '+R0)');
					asm.push(' INC R' + registerCount);
					asm.push(' STI (' + (localVarTable.indexOf(thisToken) + 1) + '+R0),R' + registerCount);
					registerCount++;
				}
			}
			getToken();
		}
		//если декремент
		else if (thisToken == '-' && operation == '-') {
			if (isVar(variable) || localVarTable.indexOf(variable) > -1 || functionVarTable.indexOf(variable) > -1) {
				if (isVar(variable))
					asm.push(' DEC _' + variable);
				else if (localVarTable.indexOf(variable)) {
					if (registerCount == 1) {
						asm.push(' LDI R' + registerCount + ',(' + (localVarTable.indexOf(variable) + 1) + '+R0)');
						registerCount++;
					}
					asm.push(' MOV R' + registerCount + ',R' + (registerCount - 1));
					asm.push(' DEC R' + registerCount);
					asm.push(' STI (' + (localVarTable.indexOf(variable) + 1) + '+R0),R' + registerCount);
				}
			} else {
				getToken();
				if (isVar(thisToken)) {
					asm.push(' DEC _' + thisToken);
					execut();
				} else if (localVarTable.indexOf(thisToken)) {
					asm.push(' LDI R' + registerCount + ',(' + (localVarTable.indexOf(thisToken) + 1) + '+R0)');
					asm.push(' DEC R' + registerCount);
					asm.push(' STI (' + (localVarTable.indexOf(thisToken) + 1) + '+R0),R' + registerCount);
					registerCount++;
				}
			}
			getToken();
		} else {
			execut();
			if (getRangOperation(thisToken) == 0)
				if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
					getToken();
			//если следующая операция выше рангом, то выполняем сразу ее
			if (getRangOperation(thisToken) > 2)
				execut();
			registerCount--;
			if (operation == '+')
				asm.push(' ADD R' + (registerCount - 1) + ',R' + registerCount);
			else if (operation == '-')
				asm.push(' SUB R' + (registerCount - 1) + ',R' + registerCount);
			if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
				execut();
		}
	}
	//деление, умножение, остаток
	function divMul() {
		var operation = thisToken;
		getToken();
		execut();
		if (getRangOperation(thisToken) == 0)
			if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
				getToken();
		//если следующая операция выше рангом, то выполняем сразу ее
		if (getRangOperation(thisToken) > 3)
			execut();
		registerCount--;
		if (operation == '*')
			asm.push(' MUL R' + (registerCount - 1) + ',R' + registerCount);
		else if (operation == '/')
			asm.push(' DIV R' + (registerCount - 1) + ',R' + registerCount);
		else if (operation == '%')
			asm.push(' DIV R' + (registerCount - 1) + ',R' + registerCount + ' \n MOV R' + (registerCount - 1) + ',R' + registerCount);
		if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
			execut();
	}
	// & | ^
	function andOrXor() {
		var operation = thisToken;
		getToken();
		if (thisToken == operation) {
			operation += thisToken;
			getToken();
		}
		execut();
		if (getRangOperation(thisToken) == 0)
			if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
				getToken();
		//если следующая операция выше рангом, то выполняем сразу ее
		if (getRangOperation(thisToken) > 1)
			execut();
		registerCount--;
		if (operation == '&' || operation == '&&')
			asm.push(' AND R' + (registerCount - 1) + ',R' + registerCount);
		else if (operation == '|' || operation == '||')
			asm.push(' OR R' + (registerCount - 1) + ',R' + registerCount);
		else if (operation == '^')
			asm.push(' XOR R' + (registerCount - 1) + ',R' + registerCount);
		if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
			execut();
	}
	//сравнение
	function compare() {
		var operation = thisToken;
		getToken();
		//если следующий токен операция, то это могут быть ==, <=, >=, !=
		if (getRangOperation(thisToken) == 1) {
			operation += thisToken;
			getToken();
		}
		execut();
		getToken();
		if (getRangOperation(thisToken) > 1)
			execut();
		else
			previousToken();
		registerCount--;
		if (operation == '>')
			asm.push(' CMP R' + (registerCount - 1) + ',R' + registerCount + '\n LDF R' + (registerCount - 1) + ',3');
		else if (operation == '<')
			asm.push(' CMP R' + (registerCount - 1) + ',R' + registerCount + '\n LDF R' + (registerCount - 1) + ',2');
		else if (operation == '==')
			asm.push(' CMP R' + (registerCount - 1) + ',R' + registerCount + '\n LDF R' + (registerCount - 1) + ',1');
		else if (operation == '!=')
			asm.push(' CMP R' + (registerCount - 1) + ',R' + registerCount + '\n LDF R' + (registerCount - 1) + ',5');
		else if (operation == '<=')
			asm.push(' CMP R' + (registerCount - 1) + ',R' + registerCount + '\n LDF R' + (registerCount - 1) + ',4');
		else if (operation == '>=')
			asm.push(' CMP R' + registerCount + ',R' + (registerCount - 1) + '\n LDF R' + (registerCount - 1) + ',4');
		else if (operation == '>>')
			asm.push(' SHR R' + (registerCount - 1) + ',R' + registerCount);
		else if (operation == '<<')
			asm.push(' SHL R' + (registerCount - 1) + ',R' + registerCount);
		if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
			getToken();
		if (!(thisToken == ',' || thisToken == ')' || thisToken == ';'))
			execut();
	}
	//обработка условных ветвлений
	function ifToken() {
		//labe делает ссылки уникальными
		var labe = labelNumber;
		labelNumber++;
		getToken();
		if (thisToken != '(')
			info("" + lineCount + " ожидалась открывающая скобка в конструкции if");
		skipBracket();
		removeNewLine();
		registerCount--;
		asm.push(' CMP R' + registerCount + ',0 \n JZ end_if_' + labe);
		getToken();
		removeNewLine();
		//если открывающая фигурная скобка пропускаем блок этих скобок
		if (thisToken == '{') {
			skipBrace();
		}
		//иначе просто выполняем до конца строки
		else {
			execut();
		}
		registerCount = 1;
		getToken();
		removeNewLine();
		//обработка else
		if (thisToken == 'else') {
			asm.push('JMP end_else_' + labe);
			asm.push('end_if_' + labe + ':');
			getToken();
			execut();
			asm.push('end_else_' + labe + ':');
		} else {
			asm.push('end_if_' + labe + ':');
			previousToken();
		}
	}

	function whileToken() {
		var labe = labelNumber;
		labelNumber++;
		getToken();
		if (thisToken != '(')
			info("" + lineCount + " ожидалась открывающая скобка в конструкции while");
		asm.push('start_while_' + labe + ':');
		skipBracket();
		registerCount--;
		asm.push(' CMP R' + registerCount + ',0 \n JZ end_while_' + labe);
		getToken();
		removeNewLine();
		if (thisToken == '{') {
			skipBrace();
			getToken();
		} else {
			execut();
		}
		asm.push(' JMP start_while_' + labe + ' \nend_while_' + labe + ':');
		removeNewLine();
	}

	function forToken() {
		var labe = labelNumber;
		var startToken;
		var memToken;
		var bracketCount = 0;
		labelNumber++;
		getToken();
		removeNewLine();
		if (thisToken != '(')
			info("" + lineCount + " ожидалась открывающая скобка в конструкции for");
		//обрабатываем часть до первой точки с запятой, это выполнится только один раз
		while (thisToken != ';') {
			getToken();
			if (!thisToken)
				return;
			execut();
		}
		registerCount = 1;
		getToken();
		//проверка будет выполнятся каждую итерацию
		asm.push('start_for_' + labe + ':');
		execut();
		while (thisToken != ';') {
			getToken();
			if (!thisToken)
				return;
			execut();
		}
		registerCount--;
		asm.push(' CMP R' + registerCount + ',0 \n JZ end_for_' + labe);
		//запоминаем третий параметр if, не транслируя, он будет выполнятся в конце цикла
		startToken = thisTokenNumber;
		while (!(thisToken == ')' && bracketCount == 0)) {
			if (thisToken == '(')
				bracketCount++;
			else if (thisToken == ')')
				bracketCount--;
			getToken();
			if (!thisToken)
				return;
		}
		getToken();
		removeNewLine();
		if (thisToken == '{') {
			skipBrace();
		} else {
			execut();
		}
		//теперь транслируем третий параметр
		memToken = thisTokenNumber;
		thisTokenNumber = startToken;
		registerCount = 1;
		getToken();
		skipBracket();
		//и восстанавливаем позицию транслирования
		thisTokenNumber = memToken;
		asm.push(' JMP start_for_' + labe + ' \nend_for_' + labe + ':');
		registerCount = 1;
	}

	function switchToken() {
		var labe = labelNumber;
		labelNumber++;
		getToken();
		if (thisToken != '(')
			info("" + lineCount + " ожидалась открывающая скобка в конструкции switch");
		skipBracket();
		registerCount--;
		//оставляем пустую ячейку в таблице asm и запоминаем ее позицию, сюда будем добавлять весь код, сгенерированный case
		switchStack.push({
			block: asm.length,
			labe: labe
		});
		asm.push(' ');
		asm.push(' JMP end_switch_' + labe);
		getToken();
		removeNewLine();
		if (thisToken == '{') {
			skipBrace();
		} else {
			info("" + lineCount + " ожидалась открывающая фигурная скобка в конструкции switch");
		}
		asm.push('end_switch_' + labe + ':');
		switchStack.pop();
		getToken();
		removeNewLine();
	}

	function caseToken() {
		var lastSwitch = {
			block: 0,
			labe: 0
		};
		var labe = labelNumber;
		labelNumber++;
		//ищем к какому switch относится этот case
		if (switchStack.length > 0)
			lastSwitch = switchStack[switchStack.length - 1];
		else
			info("" + lineCount + " отсутствует конструкция switch ");
		getToken();
		if (isNumber(thisToken)) {
			asm[lastSwitch.block] += 'CMP R1,' + parseInt(thisToken) + ' \n JZ case_' + labe + '\n ';
			asm.push(' case_' + labe + ':');
			getToken();
			if (thisToken != ':')
				info("" + lineCount + " ожидалось двоеточие ");
		} else {
			info("" + lineCount + " ожидалось число ");
		}
	}

	function defaultToken() {
		var lastSwitch = {
			block: 0,
			labe: 0
		};
		var labe = labelNumber;
		labelNumber++;
		if (switchStack.length > 0)
			lastSwitch = switchStack[switchStack.length - 1];
		else
			info("" + lineCount + " отсутствует конструкция switch ");
		getToken();
		if (thisToken != ':')
			info("" + lineCount + " ожидалось двоеточие ");
		asm[lastSwitch.block] += 'JMP default_' + labe + '\n ';
		asm.push(' default_' + labe + ':');
	}
	//break в данный момент работает только для прерывания switch, нужно доработать
	function breakToken() {
		var lastSwitch = {
			block: 0,
			labe: 0
		};
		if (switchStack.length > 0) {
			lastSwitch = switchStack[switchStack.length - 1];
			asm.push(' JMP end_switch_' + lastSwitch.labe);
		} else
			info("" + lineCount + " отсутствует конструкция switch ");
	}
	//обработка объявления типа, предполагаем что за ним следует объявление переменной или функции
	function typeToken() {
		var type = thisToken;
		if(lastToken == '*')
			type = '*' + type;
		getToken();
		removeNewLine();
		if (thisToken == '*' || thisToken == '&'){
			if(thisToken == '*')
				type = thisToken + type;
			getToken();
		}
		//приведение типа, не реализовано
		if (thisToken == ')') {
			getToken();
			execut();
			return;
		}
		getToken();
		//вызываем регестрацию функции
		if (thisToken == '(') {
			previousToken();
			addFunction(type);
		} else if (thisToken == '[') {
			addArray(type);
		}
		//объявление переменных одного типа через запятую, присваивание при этом не поддерживается
		else if (thisToken == ',') {
			previousToken();
			addVar(type);
			getToken();
			while (thisToken && thisToken != ';') {
				getToken();
				addVar(type);
				getToken();
				if (!(thisToken == ',' || thisToken == ';'))
					info("" + lineCount + " неподдерживаемое объявление переменных");
			}
		} else {
			previousToken();
			addVar(type);
		}
	}
	//обработка указателей, стандарту не соответствует
	function pointerToken() {
		if (thisToken == '&') {
			getToken();
			if (functionVarTable.indexOf(thisToken) > 0) {
				asm.push(' MOV R' + registerCount + ',R0 \n LDC R' + (registerCount + 1) + ',' + (functionVarTable.indexOf(thisToken) * 2));
				asm.push(' ADD R' + registerCount + ',R' + (registerCount + 1));
				registerCount++;
			} else if (isVar(thisToken)) {
				asm.push(' LDI R' + registerCount + ',_' + thisToken);
				registerCount++;
			}
		} else if (thisToken == '*') {
			getToken();
			if (functionVarTable.indexOf(thisToken) > 0) {
				asm.push(' LDI R' + registerCount + ',(' + localStackLength * 2 + functionVarTable.length - functionVarTable.indexOf(thisToken) + 1 + '+R0) ;' + thisToken);
				asm.push(' LDI R' + registerCount + ',(R' + registerCount + ')');
				registerCount++;
			} else if (isVar(thisToken)) {
				asm.push(' LDI R' + registerCount + ',(_' + thisToken + ')');
				asm.push(' LDI R' + registerCount + ',(R' + registerCount + ')');
				registerCount++;
			}
		}
	}
	//обработка строки. Добавляет строку и оставляет в регистре ссылку на нее
	function stringToken() {
		var labe = labelNumber;
		labelNumber++;
		dataAsm.push('_str' + labe + ':');
		pushString();
		asm.push(' LDI R' + registerCount + ',_str' + labe);
		registerCount++;
	}
	//удаляем перевод строки, если есть
	function removeNewLine() {
		var s;
		if (thisToken === '\n') {
			if (lastToken == ';')
				registerCount = 1;
			if (thisTokenNumber - lastEndString > 1) {
				//добавляем информацию для отладки
				numberDebugString.push([asm.length, lineCount, 0]);
				//добавляем комментарии в таблицу asm для отладки
				s = ';' + lineCount + ' ' + t.slice(lastEndString, thisTokenNumber - 1).join(' ').replace(/\r|\n/g, '');
				if (s.length > 40)
					s = s.substring(0, 40) + '...';
				asm.push(s);
			}
			//пропускаем все последующие пустые переводы строки
			while (thisToken === '\n') {
				lineCount++;
				lastEndString = thisTokenNumber;
				getToken();
			}
		}
	}
	//выполняем блок скобок
	function skipBracket() {
		while (thisToken != ')') {
			if (getRangOperation(thisToken) == 0)
				getToken();
			if (!thisToken)
				return;
			execut();
		}
		removeNewLine();
	}
	//выполняем блок фигурных скобок
	function skipBrace() {
		while (thisToken && thisToken != '}') {
			getToken();
			if (!thisToken)
				return;
			execut();
		}
		removeNewLine();
		registerCount = 1;
	}
	//определение типа токена и необходимой операции
	function execut() {
		//выйти, если токены закончились
		if (!thisToken) {
			return;
		}
		removeNewLine();
		if (isType(thisToken)) {
			typeToken();
		} else if (functionVarTable.indexOf(thisToken) > 0 || localVarTable.indexOf(thisToken) > 0) {
			localVarToken();
		} else if (isVar(thisToken)) {
			varToken();
		} else if (isFunction(thisToken)) {
			callFunction(thisToken);
		} else if (isNumber(thisToken)) {
			thisToken = '' + parseInt(thisToken);
			//байт код для добавления восьмибитного числа будет короче на два байта, по возможности добавляем его
			if ((thisToken * 1) < 255)
				asm.push(' LDC R' + registerCount + ',' + thisToken);
			else
				asm.push(' LDI R' + registerCount + ',' + thisToken);
			registerCount++;
		} else if (getRangOperation(thisToken) > 0) {
			//в этих условиях скорее всего работа с указателями, но это не всегда так, нужно улучшить
			if (thisToken == '&' && (lastToken == '(' || lastToken == '=' || lastToken == ','))
				pointerToken();
			else if (thisToken == '*' && (lastToken == '(' || lastToken == '=' || lastToken == ','))
				pointerToken();
			else if (thisToken == '*' && registerCount == 1){
				getToken();
				execut();
			}
			else if (thisToken == '+' || thisToken == '-')
				addSub();
			else if (thisToken == '*' || thisToken == '/' || thisToken == '%')
				divMul();
			else if (thisToken == '&' || thisToken == '|' || thisToken == '^')
				andOrXor();
			else
				compare();
			return;
		} else if (thisToken == '(') {
			skipBracket();
			if (thisToken == ';')
				info("" + lineCount + " ожидалась скобка");
			getToken();
		} else if (thisToken == '=') {
			assigment();
		} else if (thisToken == ';') {
			//после точки с запятой данные, оставшиеся в регистрах, больше не нужны, указатель регистра обнуляется
			if (registerCount != 1)
				registerCount == 1;
			return;
		} else if (thisToken == '{') {
			skipBrace();
			getToken();
		} else if (thisToken == '}' || thisToken == ']' || thisToken == ')' || thisToken == ',') {
			return;
		} else if (thisToken == 'true') {
			asm.push(' LDC R' + registerCount + ',1');
		} else if (thisToken == 'false') {
			asm.push(' LDC R' + registerCount + ',0');
		} else if (thisToken == 'return') {
			returnToken();
		} else if (thisToken == 'if') {
			ifToken();
		} else if (thisToken == 'else') {
			return;
		} else if (thisToken == 'while') {
			whileToken();
		} else if (thisToken == 'for') {
			forToken();
		} else if (thisToken == 'switch') {
			switchToken();
		} else if (thisToken == 'case') {
			caseToken();
		} else if (thisToken == 'default') {
			defaultToken();
		} else if (thisToken == 'break') {
			breakToken();
		} else if (thisToken == 'unsigned') {
			info("" + lineCount + "предупреждение, unsigned не реализовано " + thisToken);
			return;
		} else if (thisToken[0] == '"') {
			stringToken();
		} else {
			if (thisToken.length > 0)
				info("" + lineCount + " неизвестный токен " + thisToken);
		}
	}

	numberDebugString = [];
	console.time("compile");
	//регистрируем некоторые стандартные функции
	registerFunction('random', 'int', ['int', 'i'], 1, 'RAND R%1', true, 0);
	registerFunction('putchar', 'char', ['char', 'c'], 1, 'PUTC R%1', true, 0);
	registerFunction('puts', 'int', ['*char', 'c'], 1, 'PUTS R%1', true, 0);
	registerFunction('putn', 'int', ['int', 'n'], 1, 'PUTN R%1', true, 0);
	registerFunction('gettimer', 'int', ['int', 'n'], 1, 'GTIMER R%1', true, 0);
	registerFunction('settimer', 'void', ['int', 'n', 'int', 't'], 1, 'STIMER R%2,R%1', true, 0);
	registerFunction('clearscreen', 'void', [], 1, 'CLS', true, 0);
	registerFunction('setcolor', 'void', ['int', 'c'], 1, 'SFCLR R%1', true, 0);
	registerFunction('getchar', 'int', [], 1, 'GETK R%0', true, 0);
	registerFunction('getkey', 'int', [], 1, 'GETJ R%0', true, 0);
	registerFunction('putpixel', 'void', ['int', 'x', 'int', 'y'], 1, 'PPIX R%2,R%1', true, 0);
	registerFunction('getsprite', 'void', ['int', 'n', 'int', 'a'], 1, 'LDSPRT R%2,R%1', true, 0);
	registerFunction('putsprite', 'void', ['int', 'n', 'int', 'x', 'int', 'y'], 1, 'DRSPRT R%3,R%2,R%1', true, 0);
	registerFunction('setimagesize', 'void', ['int', 's'], 1, 'ISIZE R%1', true, 0);
	registerFunction('gotoxy', 'void', ['int', 'x', 'int', 'y'], 1, 'SETX R%2 \n SETY R%1', true, 0);
	registerFunction('line', 'void', ['int', 'x', 'int', 'y', 'int', 'x1', 'int', 'y1'], 1, '_line: \n MOV R1,R0 \n LDC R2,2 \n ADD R1,R2 \n DLINE R1 \n RET', false, 0);
	dataAsm = [];
	dataAsm.push('_putimage: \n MOV R1,R0 \n LDC R2,2 \n ADD R1,R2 \n DRWIM R1 \n RET');
	registerFunction('putimage', 'void', ['int', 'a', 'int', 'x', 'int', 'y', 'int', 'w', 'int', 'h'], 1, dataAsm, false, 0);
	dataAsm = [];
	dataAsm.push('_putimagerle: \n MOV R1,R0 \n LDC R2,2 \n ADD R1,R2 \n DRWRLE R1 \n RET');
	registerFunction('putimagerle', 'void', ['int', 'a', 'int', 'x', 'int', 'y', 'int', 'w', 'int', 'h'], 1, dataAsm, false, 0);
	dataAsm = [];
	dataAsm.push('_printf: \n MOV R2,R0 \n ADD R2,R1 \n LDI R2,(R2) \n LDC R3,(R2) \nnext_printf_c:')
	dataAsm.push(' CMP R3,37 ;% \n JZ printf_get\n PUTC R3\n INC R2 \n LDC R3,(R2) \n JNZ next_printf_c');
	dataAsm.push(' RET \nnext_printf_c_end:\n INC R2 \n LDC R3,(R2)\n JNZ next_printf_c \n RET\nprintf_get:');
	dataAsm.push(' INC R2 \n LDC R3,(R2) \n CMP R3,37 ;%\n JZ printf_percent\n DEC R1,2 \n LDI R4,(R1+R0)');
	dataAsm.push(' CMP R3,68 ;D\n JZ printf_d \n CMP R3,73 ;I\n JZ printf_d \n CMP R3,83 ;S\n JZ printf_s \n CMP R3,67 ;C\n JZ printf_c');
	dataAsm.push(' JMP next_printf_c \nprintf_percent:\n PUTC R3 \n JMP next_printf_c_end \nprintf_d: \n PUTN R4');
	dataAsm.push(' JMP next_printf_c_end\nprintf_c: \n PUTC R4\n JMP next_printf_c_end\nprintf_s:\n PUTS R4 \n JMP next_printf_c_end');
	registerFunction('printf', 'int', ['*char', 's', '...'], 1, dataAsm, false, 0);
	dataAsm = [];
	dataAsm.push('_free:\n LDI R1,(2 + R0)\n DEC R1,2\n LDI R3,32768\n LDI R2,(R1)\n SUB R2,R3\n LDI R4,(R1+R2)\n CMP R4,0\n JZ end_free_0');
	dataAsm.push(' CMP R3,R4\n JP next_free\n STI (R1),R2\n RET \nend_free_0:\n LDI R2,0\n STI (R1),R2\n RET\nnext_free:\n ADD R2,R4');
	dataAsm.push(' LDI R4,(R1+R2)\n CMP R4,0\n JZ end_free_0\n CMP R3,R4\n JP next_free\n STI (R1),R2 \n RET');
	registerFunction('free', 'void', ['int', 'a'], 1, dataAsm, false, 0);
	dataAsm = [];
	dataAsm.push('\n_malloc: \n LDI R2,(2 + R0)\n CMP R2,0 \n JZ end_malloc \n  MOV R5,R2\n LDC R4,1\n AND R5,R4\n CMP R5,1\n JNZ next_malloc');
	dataAsm.push(' INC R2\nnext_malloc:\n INC R2,2\n LDI R1,#END \n LDI R4,32768 ;0x8000\nnext_byte:\n LDI R3,(R1)\n CMP R3,R4');
	dataAsm.push(' JNP malloc1 \n SUB R3,R4\n ADD R1,R3 \n CMP R1,R0 \n JP end_malloc\n JMP next_byte\nmalloc1:\n CMP R3,0 \n JNZ malloc2');
	dataAsm.push(' MOV R5,R2\n ADD R5,R1\n CMP R5,R0 \n JP end_malloc\n ADD R2,R4\n STI (R1),R2\n INC R1,2\n RET\nmalloc2: \n MOV R6,R3');
	dataAsm.push(' SUB R6,R2\n JNP next_byte1 \n MOV R5,R2\n ADD R5,R1\n CMP R5,R0\n JP end_malloc\n ADD R2,R4\n STI (R1),R2\n INC R1,2');
	dataAsm.push(' CMP R6,0 \n JZ ret_malloc\n STI (R5),R6\n RET\n next_byte1: \n ADD R1,R3 \n JMP next_byte \nend_malloc:\n LDC R1,0\n RET');
	dataAsm.push('ret_malloc:\n RET');
	registerFunction('malloc', 'int', ['int', 'l'], 1, dataAsm, false, 0);
	dataAsm = [];
	//основной цикл компиляции, выполняется пока есть токены на входе
	while (getToken()) {
		execut();
	}
	//указываем место для кучи, если нужно
	if(isFunction('malloc'))
		asm.push(' LDI R15,0 \n STI (#END),R15');
	//в конце программы вызываем main если есть
	if (isFunction('main')){
		for (var i = 0; i < functionTable.length; i++) {
			if (functionTable[i].name == 'main'){
				if (functionTable[i].varLength > 0) {
					if (functionTable[i].varLength < 15)
						asm.push(' DEC R0,' + functionTable[i].varLength);
					else
						asm.push(' LDC R15,' + functionTable[i].varLength + '\n SUB R0,R15');
				}
				break;
			}
		}
		asm.push(' CALL _main');
	}
	//если ее нет, то программа будет работать все равно
	else
		info("не найдена точка входа в функцию main");
	//при возврате из main останавливаем выполнение программы
	asm.push('HLT');
	//проверяем, были ли хоть раз вызваны функции и добовляем код только вызванных
	for (var i = 0; i < functionTable.length; i++) {
		if (functionTable[i].use > 0)
			asm = asm.concat(functionTable[i].asm);
	}
	//объеденяем код с данными
	asm = asm.concat(dataAsm);
	console.timeEnd("compile");

	return asm;
}